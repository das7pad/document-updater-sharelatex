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
const ShareJsDB = require('./ShareJsDB')
const logger = require('logger-sharelatex')
const Settings = require('@overleaf/settings')
const Keys = require('./UpdateKeys')
const { EventEmitter } = require('events')
const util = require('util')
const RealTimeRedisManager = require('./RealTimeRedisManager')
const crypto = require('crypto')
const metrics = require('./Metrics')
const Errors = require('./Errors')

ShareJsModel.prototype = {}
util.inherits(ShareJsModel, EventEmitter)

const MAX_AGE_OF_OP = 80

module.exports = ShareJsUpdateManager = {
  getNewShareJsModel(project_id, doc_id, lines, version) {
    const db = new ShareJsDB(project_id, doc_id, lines, version)
    const model = new ShareJsModel(db, {
      maxDocLength: Settings.max_doc_length,
      maximumAge: MAX_AGE_OF_OP
    })
    model.db = db
    return model
  },

  applyUpdate(project_id, doc_id, update, lines, version, callback) {
    if (callback == null) {
      callback = function (error, updatedDocLines) {}
    }
    logger.log({ project_id, doc_id, update }, 'applying sharejs updates')
    const jobs = []
    // record the update version before it is modified
    const incomingUpdateVersion = update.v
    // We could use a global model for all docs, but we're hitting issues with the
    // internal state of ShareJS not being accessible for clearing caches, and
    // getting stuck due to queued callbacks (line 260 of sharejs/server/model.coffee)
    // This adds a small but hopefully acceptable overhead (~12ms per 1000 updates on
    // my 2009 MBP).
    const model = this.getNewShareJsModel(project_id, doc_id, lines, version)
    const doc_key = Keys.combineProjectIdAndDocId(project_id, doc_id)
    model.applyOp(doc_key, update, (error, docVersion, op, snapshot) => {
      if (error != null) {
        if (error === 'Op already submitted') {
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
        } else if (/^Delete component/.test(error)) {
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
      logger.log({ project_id, doc_id, error }, 'applied update')
      RealTimeRedisManager.sendData({ project_id, doc_id, op })

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

      const docLines = snapshot.split(/\r\n|\n|\r/)
      callback(null, docLines, docVersion, [op])
    })
  },

  _computeHash(content) {
    return crypto
      .createHash('sha1')
      .update('blob ' + content.length + '\x00')
      .update(content, 'utf8')
      .digest('hex')
  }
}
