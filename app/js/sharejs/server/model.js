/* eslint-disable
    no-console,
    no-return-assign,
    standard/no-callback-literal,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS104: Avoid inline assignments
 * DS204: Change includes calls to have a more natural evaluation order
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// The model of all the ops. Responsible for applying & transforming remote deltas
// and managing the storage layer.
//
// Actual storage is handled by the database wrappers in db/*, wrapped by DocCache

let Model

const types = require('../types')

// This constructor creates a new Model object. There will be one model object
// per server context.
//
// The model object is responsible for a lot of things:
//
// - It manages the interactions with the database
// - It maintains (in memory) a set of all active documents
// - It calls out to the OT functions when necessary
//
module.exports = Model = function (db, options) {
  if (!(this instanceof Model)) {
    return new Model(db, options)
  }

  if (options == null) {
    options = {}
  }

  // The number of operations the cache holds before reusing the space
  if (options.numCachedOps == null) {
    options.numCachedOps = 10
  }

  // Until I come up with a better strategy, we'll save a copy of the document snapshot
  // to the database every ~20 submitted ops.
  if (options.opsBeforeCommit == null) {
    options.opsBeforeCommit = 20
  }

  // It takes some processing time to transform client ops. The server will punt ops back to the
  // client to transform if they're too old.
  if (options.maximumAge == null) {
    options.maximumAge = 40
  }

  // **** Cache API methods

  // Its important that all ops are applied in order. This helper method creates the op submission queue
  // for a single document. This contains the logic for transforming & applying ops.
  const makeOpProcessor = (docName, doc) =>
    function (opData, callback) {
      if (!(opData.v >= 0)) {
        return callback('Version missing')
      }
      if (opData.v > doc.v) {
        return callback('Op at future version')
      }

      // Punt the transforming work back to the client if the op is too old.
      if (opData.v + options.maximumAge < doc.v) {
        return callback('Op too old')
      }

      if (!opData.meta) {
        opData.meta = {}
      }
      opData.meta.ts = Date.now()

      // We'll need to transform the op to the current version of the document. This
      // calls the callback immediately if opVersion == doc.v.
      getOps(doc, docName, opData.v, doc.v, function (error, ops) {
        let snapshot
        if (error) {
          return callback(error)
        }

        if (doc.v - opData.v !== ops.length) {
          // This should never happen. It indicates that we didn't get all the ops we
          // asked for. Its important that the submitted op is correctly transformed.
          console.error(
            `Could not get old ops in model for document ${docName}`
          )
          console.error(
            `Expected ops ${opData.v} to ${doc.v} and got ${ops.length} ops`
          )
          return callback('Internal error')
        }

        if (ops.length > 0) {
          try {
            // If there's enough ops, it might be worth spinning this out into a webworker thread.
            for (const oldOp of Array.from(ops)) {
              // Dup detection works by sending the id(s) the op has been submitted with previously.
              // If the id matches, we reject it. The client can also detect the op has been submitted
              // already if it sees its own previous id in the ops it sees when it does catchup.
              if (
                oldOp.meta.source &&
                opData.dupIfSource &&
                Array.from(opData.dupIfSource).includes(oldOp.meta.source)
              ) {
                return callback('Op already submitted')
              }

              opData.op = doc.type.transform(opData.op, oldOp.op, 'left')
              opData.v++
            }
          } catch (error1) {
            error = error1
            console.error(error.stack)
            return callback(error.message)
          }
        }

        try {
          snapshot = doc.type.apply(doc.snapshot, opData.op)
        } catch (error2) {
          error = error2
          console.error(error.stack)
          return callback(error.message)
        }

        if (
          options.maxDocLength != null &&
          doc.snapshot.length > options.maxDocLength
        ) {
          return callback('Update takes doc over max doc size')
        }

        // The op data should be at the current version, and the new document data should be at
        // the next version.
        //
        // This should never happen in practice, but its a nice little check to make sure everything
        // is hunky-dory.
        if (opData.v !== doc.v) {
          // This should never happen.
          console.error(
            'Version mismatch detected in model. File a ticket - this is a bug.'
          )
          console.error(`Expecting ${opData.v} == ${doc.v}`)
          return callback('Internal error')
        }

        // All the heavy lifting is now done. Finally, we'll update the cache with the new data
        // and (maybe!) save a new document snapshot to the database.

        doc.v = opData.v + 1
        doc.snapshot = snapshot

        doc.ops.push(opData)
        if (db && doc.ops.length > options.numCachedOps) {
          doc.ops.shift()
        }

        callback(null, doc.v, opData, snapshot)
      })
    }

  // Add the data for the given docName to the cache. The named document shouldn't already
  // exist in the doc set.
  //
  // Returns the new doc.
  function add(docName, callback, data, committedVersion, ops, dbMeta) {
    const doc = {
      snapshot: data.snapshot,
      v: data.v,
      type: data.type,
      meta: data.meta,

      // Cache of ops
      ops: ops || [],

      // Version of the snapshot thats in the database
      committedVersion: committedVersion != null ? committedVersion : data.v,
      snapshotWriteLock: false,
      dbMeta
    }

    doc.processOp = makeOpProcessor(docName, doc)

    callback(null, doc)
  }

  // This is a little helper wrapper around db.getOps. It does two things:
  //
  // - If there's no database set, it returns an error to the callback
  // - It adds version numbers to each op returned from the database
  // (These can be inferred from context so the DB doesn't store them, but its useful to have them).
  const getOpsInternal = function (docName, start, end, callback) {
    return db.getOps(docName, start, end, function (error, ops) {
      if (error) {
        return typeof callback === 'function' ? callback(error) : undefined
      }

      let v = start
      for (const op of Array.from(ops)) {
        op.v = v++
      }

      return typeof callback === 'function' ? callback(null, ops) : undefined
    })
  }

  // Load the named document into the cache. This function is re-entrant.
  //
  // The callback is called with (error, doc)
  const load = function (docName, callback) {
    db.getSnapshot(docName, function (error, data, dbMeta) {
      if (error) {
        return callback(error)
      }

      const type = types[data.type]
      if (!type) {
        console.warn(`Type '${data.type}' missing`)
        return callback('Type not found')
      }
      data.type = type

      const committedVersion = data.v

      // The server can close without saving the most recent document snapshot.
      // In this case, there are extra ops which need to be applied before
      // returning the snapshot.
      return getOpsInternal(docName, data.v, null, function (error, ops) {
        if (error) {
          return callback(error)
        }

        if (ops.length > 0) {
          console.log(`Catchup ${docName} ${data.v} -> ${data.v + ops.length}`)

          try {
            for (const op of Array.from(ops)) {
              data.snapshot = type.apply(data.snapshot, op.op)
              data.v++
            }
          } catch (e) {
            // This should never happen - it indicates that whats in the
            // database is invalid.
            console.error(`Op data invalid for ${docName}: ${e.stack}`)
            return callback('Op data invalid')
          }
        }

        return add(docName, callback, data, committedVersion, ops, dbMeta)
      })
    })
  }

  // *** Model interface methods

  // This gets all operations from [start...end]. (That is, its not inclusive.)
  //
  // end can be null. This means 'get me all ops from start'.
  //
  // Each op returned is in the form {op:o, meta:m, v:version}.
  //
  // Callback is called with (error, [ops])
  //
  // If the document does not exist, getOps doesn't necessarily return an error. This is because
  // its awkward to figure out whether or not the document exists for things
  // like the redis database backend. I guess its a bit gross having this inconsistant
  // with the other DB calls, but its certainly convenient.
  //
  // Use getVersion() to determine if a document actually exists, if thats what you're
  // after.
  function getOps(doc, docName, start, end, callback) {
    // getOps will only use the op cache if its there. It won't fill the op cache in.
    if (!(start >= 0)) {
      throw new Error('start must be 0+')
    }
    const ops = doc.ops

    if (ops) {
      const version = doc.v

      // Ops contains an array of ops. The last op in the list is the last op applied
      if (end == null) {
        end = version
      }
      start = Math.min(start, end)

      if (start === end) {
        return callback(null, [])
      }

      // Base is the version number of the oldest op we have cached
      const base = version - ops.length

      // If the database is null, we'll trim to the ops we do have and hope thats enough.
      if (start >= base) {
        return callback(null, ops.slice(start - base, end - base))
      }
    }

    return getOpsInternal(docName, start, end, callback)
  }

  // Apply an op to the specified document.
  // The callback is passed (error, applied version #)
  // opData = {op:op, v:v, meta:metadata}
  //
  // Ops are queued before being applied so that the following code applies op C before op B:
  // model.applyOp 'doc', OPA, -> model.applyOp 'doc', OPB
  // model.applyOp 'doc', OPC
  this.applyOp = (
    docName,
    opData,
    callback // All the logic for this is in makeOpQueue, above.
  ) =>
    load(docName, function (error, doc) {
      if (error) {
        return callback(error)
      }

      doc.processOp(opData, callback)
    })
}
