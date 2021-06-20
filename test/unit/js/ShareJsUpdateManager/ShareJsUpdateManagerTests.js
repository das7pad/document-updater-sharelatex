/* eslint-disable
    no-return-assign,
    no-unused-vars,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const sinon = require('sinon')
const chai = require('chai')
const should = chai.should()
const modulePath = '../../../../app/js/ShareJsUpdateManager.js'
const SandboxedModule = require('sandboxed-module')
const crypto = require('crypto')

describe('ShareJsUpdateManager', function () {
  beforeEach(function () {
    let Model
    this.project_id = 'project-id-123'
    this.doc_id = 'document-id-123'
    this.callback = sinon.stub()
    return (this.ShareJsUpdateManager = SandboxedModule.require(modulePath, {
      requires: {
        './sharejs/server/model': (this.ShareJSModel = {
          applyUpdate: sinon.stub()
        }),
        '@overleaf/redis-wrapper': {
          createClient: () => {
            return (this.rclient = { auth() {} })
          }
        },
        'logger-sharelatex': (this.logger = { log: sinon.stub() }),
        './RedisManager': {
          getPreviousDocOps: sinon.stub().yields(null, [])
        },
        './RealTimeRedisManager': (this.RealTimeRedisManager = {
          sendData: sinon.stub()
        }),
        './Metrics': (this.metrics = { inc: sinon.stub() })
      },
      globals: {
        clearTimeout: (this.clearTimeout = sinon.stub())
      }
    }))
  })

  describe('applyUpdate', function () {
    beforeEach(function () {
      this.lines = ['one', 'two']
      this.version = 34
      this.updatedDocLines = ['onefoo', 'two']
      const content = this.updatedDocLines.join('\n')
      this.hash = crypto
        .createHash('sha1')
        .update('blob ' + content.length + '\x00')
        .update(content, 'utf8')
        .digest('hex')
      this.update = { p: 4, t: 'foo', v: this.version, hash: this.hash }
      this.ShareJSModel.applyUpdate.callsArgWith(
        4,
        null,
        this.version + 1,
        this.update,
        content
      )
    })

    describe('successfully', function () {
      beforeEach(function (done) {
        return this.ShareJsUpdateManager.applyUpdate(
          this.project_id,
          this.doc_id,
          this.update,
          this.lines,
          this.version,
          (err, docLines, version, appliedOps) => {
            this.callback(err, docLines, version, appliedOps)
            return done()
          }
        )
      })

      return it('should return the updated doc lines, version and ops', function () {
        return this.callback
          .calledWith(null, this.updatedDocLines, this.version + 1, [
            this.update
          ])
          .should.equal(true)
      })
    })

    describe('when applyOp fails', function () {
      beforeEach(function (done) {
        this.error = new Error('Something went wrong')
        this.ShareJSModel.applyUpdate.callsArgWith(4, this.error)
        return this.ShareJsUpdateManager.applyUpdate(
          this.project_id,
          this.doc_id,
          this.update,
          this.lines,
          this.version,
          (err, docLines, version) => {
            this.callback(err, docLines, version)
            return done()
          }
        )
      })

      return it('should call the callback with the error', function () {
        return this.callback.calledWith(this.error).should.equal(true)
      })
    })

    return describe('with an invalid hash', function () {
      beforeEach(function (done) {
        this.error = new Error('invalid hash')
        this.ShareJSModel.applyUpdate.callsArgWith(
          4,
          null,
          this.version + 1,
          this.update,
          'unexpected content'
        )
        return this.ShareJsUpdateManager.applyUpdate(
          this.project_id,
          this.doc_id,
          this.update,
          this.lines,
          this.version,
          (err, docLines, version, appliedOps) => {
            this.callback(err, docLines, version, appliedOps)
            return done()
          }
        )
      })

      return it('should call the callback with the error', function () {
        return this.callback
          .calledWith(sinon.match.instanceOf(Error))
          .should.equal(true)
      })
    })
  })
})
