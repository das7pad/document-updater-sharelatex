const OError = require('@overleaf/o-error')
const Errors = require('../../Errors')
const text = require('../types/text')

/**
 * @typedef Op
 */

/**
 * @typedef UpdateMeta
 * @property {string} source
 * @property {number} ts
 */

/**
 * @typedef Update
 * @property {Op} op
 * @property {number} v
 * @property {[]<string>} dupIfSource
 * @property {UpdateMeta} meta
 */

/**
 * @callback getOpsCb
 * @param {Error} err
 * @param {[]<Update>} updates
 */

/**
 * @callback getRemoteOpsFn
 * @param {number} start
 * @param {number} end
 * @param {getOpsCb} cb
 */

/**
 * @callback applyUpdateCb
 * @param {Error} err
 * @param {number} version
 * @param {Update} update
 * @param {string} snapshot
 */

/**
 * @callback applyUpdateCbError
 * @param {Error} err
 */

/**
 * @param {string} snapshot
 * @param {number} version
 * @param {Update} update
 * @param {getRemoteOpsFn} getRemoteOps
 * @param {applyUpdateCb | applyUpdateCbError} cb
 */
function applyUpdate(snapshot, version, update, getRemoteOps, cb) {
  if (!update.meta) {
    update.meta = {}
  }
  update.meta.ts = Date.now()
  const originalUpdateVersion = update.v

  getRemoteOps(update.v, -1, (err, updates) => {
    if (err) {
      return cb(
        new OError('cannot get remote ops', { start: update.v, end: -1 }, err)
      )
    }

    // Check for missing updates in redis.
    if (updates.length > 0) {
      const receivedStartVersion = updates[0].v
      const nUpdates = updates.length
      if (receivedStartVersion !== update.v || nUpdates < version - update.v) {
        return cb(
          new OError('updates do not match getOps request', {
            startVersion: update.v,
            receivedStartVersion,
            minEndVersion: version,
            nUpdates
          })
        )
      }
    }

    // Transform the update
    if (updates.length > 0) {
      let transformUpdate
      try {
        for (transformUpdate of updates) {
          // Dup detection works by sending the id(s) the op has been submitted with previously.
          // If the id matches, we reject it. The client can also detect the op has been submitted
          // already if it sees its own previous id in the ops it sees when it does catchup.
          if (
            transformUpdate.meta.source &&
            update.dupIfSource &&
            update.dupIfSource.includes(transformUpdate.meta.source)
          ) {
            return cb(new Errors.DuplicateOpError())
          }

          update.op = text.transform(update.op, transformUpdate.op, 'left')
          update.v++
        }
      } catch (e) {
        return cb(
          new OError('cannot transform update', { update, transformUpdate }, e)
        )
      }
    }

    // Transform the snapshot
    // TODO(das7pad): Consider dropping this, also change getRemoteOps end.
    //                All of version/snapshot/updates are set in multi.
    //                Getting catchUpUpdates hints on broken locking.
    const catchUpUpdates = updates.slice(version - originalUpdateVersion)
    if (catchUpUpdates.length > 0) {
      let catchUpUpdate
      try {
        for (catchUpUpdate of catchUpUpdates) {
          snapshot = text.apply(snapshot, catchUpUpdate.op)
          version++
        }
      } catch (e) {
        return cb(new OError('cannot catch up snapshot', { catchUpUpdate }, e))
      }
    }

    if (update.v !== version) {
      return cb(
        new OError('transform/catch up incomplete', {
          updateVersion: update.v,
          version
        })
      )
    }

    try {
      snapshot = text.apply(snapshot, update.op)
    } catch (e) {
      return cb(new OError(e.message, { update, snapshot }, e))
    }
    version++

    cb(null, version, update, snapshot)
  })
}

module.exports = {
  applyUpdate
}
