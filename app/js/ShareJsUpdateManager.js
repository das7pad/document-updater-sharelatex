/* eslint-disable
    camelcase,
    handle-callback-err,
    no-unused-vars,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
let ShareJsUpdateManager
const ShareJsModel = require('./sharejs/server/model')
const logger = require('logger-sharelatex')
const Settings = require('@overleaf/settings')
const RealTimeRedisManager = require('./RealTimeRedisManager')
const crypto = require('crypto')
const metrics = require('./Metrics')
const Errors = require('./Errors')
const RedisManager = require('./RedisManager')

const MAX_AGE_OF_OP = 80

function checkVersion(incoming, current) {
  if (!(incoming >= 0)) {
    return new Errors.InvalidVersionError('Version missing')
  }
  if (incoming > current) {
    return new Errors.InvalidVersionError('Op at future version')
  }
  if (incoming + MAX_AGE_OF_OP < current) {
    return new Errors.InvalidVersionError('Op too old')
  }
}

module.exports = ShareJsUpdateManager = {
  applyUpdate(project_id, doc_id, update, lines, version, callback) {
    if (callback == null) {
      callback = function (error, updatedDocLines) {}
    }
    logger.log({ project_id, doc_id, update }, 'applying sharejs updates')
    const jobs = []
    // record the update version before it is modified
    const incomingUpdateVersion = update.v

    const err = checkVersion(incomingUpdateVersion, version)
    if (err) {
      metrics.inc('sharejs.other-error')
      return callback(err)
    }

    ShareJsModel.applyUpdate(
      lines.join('\n'),
      version,
      update,
      (start, end, cb) =>
        RedisManager.getPreviousDocUpdatesUnderLock(doc_id, start, end, cb),
      (error, docVersion, op, snapshot) => {
        if (error != null) {
          if (error.message === 'Op already submitted') {
            metrics.inc('sharejs.already-submitted')
            logger.warn(
              { project_id, doc_id, update },
              'op has already been submitted'
            )
            const minOp = {
              doc: doc_id,
              v: update.v,
              dup: true
            }
            RealTimeRedisManager.sendData({ project_id, doc_id, op: minOp })
            return callback(new Errors.DuplicateOpError())
          } else if (/^Delete component/.test(error.message)) {
            metrics.inc('sharejs.delete-mismatch')
            logger.warn(
              { project_id, doc_id, update, shareJsErr: error },
              'sharejs delete does not match'
            )
            error = new Errors.DeleteMismatchError(
              'Delete component does not match'
            )
            return callback(error)
          } else {
            metrics.inc('sharejs.other-error')
            return callback(error)
          }
        }

        if (snapshot.length > Settings.max_doc_length) {
          metrics.inc('sharejs.other-error')
          return callback(
            new Errors.TooLargeError('Update takes doc over max doc size')
          )
        }

        // only check hash when present and no other updates have been applied
        if (update.hash != null && incomingUpdateVersion === version) {
          const ourHash = ShareJsUpdateManager._computeHash(snapshot)
          if (ourHash !== update.hash) {
            metrics.inc('sharejs.hash-fail')
            return callback(new Error('Invalid hash'))
          } else {
            metrics.inc('sharejs.hash-pass')
          }
        }

        logger.log({ project_id, doc_id, error }, 'applied update')
        RealTimeRedisManager.sendData({ project_id, doc_id, op })

        const docLines = snapshot.split('\n')
        callback(null, docLines, docVersion, [op])
      }
    )
  },

  _computeHash(content) {
    return crypto
      .createHash('sha1')
      .update('blob ' + content.length + '\x00')
      .update(content, 'utf8')
      .digest('hex')
  }
}
