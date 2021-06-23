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

  getRemoteOps(update.v, version, (err, updates) => {
    if (err) {
      return cb(
        new OError('cannot get remote ops', { start: update.v, version }, err)
      )
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

    if (update.v !== version) {
      return cb(
        new OError('transform incomplete', {
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
