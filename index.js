'use strict';

var KEEP_ALIVE = 30 * 1000;
var Duplex     = require('stream').Duplex;
var inherits   = require('util').inherits;
var logfmt     = require('logfmt');

/**
 * A Stream for managing communication between a ShareJS client and a ws client
 *
 *     var ShareJSStream = require('share-js-stream');
 *     var WsServer      = require('ws').Server;
 *     var http          = require('http');
 *     var livedb        = require('livedb');
 *     var shareServer   = require('share').server.createClient({
 *       backend: livedb.client(livedb.memory()) 
 *     });
 *
 *     http.createServer().listen(process.env.PORT, function onListen() {
 *       var wsServer = new WsServer({ server: this });
 *       wsServer.on('connection', onConnection);
 *     });
 *
 *     function onConnection(conn) {
 *       var stream = new ShareJSStream(conn);
 *       shareServer.listen(stream);
 *     }
 *
 * @class ShareJSStream
 * @extends Duplex
 * @constructor
 * @param {WebSocket} ws a websocket connection
 * @param {Object} [options] options for configuring the stream
 * @param {Number} [options.keepAlive=30000] a keep alive interval (in ms) on
 *   which the stream will send a `null` message to the client
 */
function ShareJSStream(ws, options) {
  options = options || {};
  options.keepAlive = options.keepAlive !== undefined ?
    options.keepAlive : KEEP_ALIVE;

  this.debug         = options.debug === true;
  this.ws            = ws;
  this.headers       = this.ws.upgradeReq.headers;
  this.remoteAddress = this.ws.upgradeReq.connection.remoteAddress;

  if (this.debug) {
    this.logger = logfmt.namespace({ ns: 'share-js-stream' });
  }

  Duplex.call(this, { objectMode: true });

  /**
   * Send a `null` message to the ws so that the connection is kept alive.
   *
   * This may not be necessary on all platforms.
   *
   * @method keepAlive
   * @private
   */
  this.keepAlive = function keepAlive() {
    this.log({ evt: 'keepAlive' });
    this.ws.send(null);
  }.bind(this);

  /**
   * Handle a closed ws client.
   *
   * This is called when the `close` event is emitted on the ws client. It:
   *
   * - Clears the keep alive interval (if there is one)
   * - Pushes `null` to end the stream
   * - Emits `close` on the stream
   * - Closes the ws client
   *
   * @method onWsClose
   * @private
   * @param {Number} code the reason code for why the client was closed
   * @param {String} message a message accompanying the close
   */
  this.onWsClose = function onWsClose(code, message) {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    this.log({ evt: 'wsClose', code: code, message: message });
    this.push(null);
    this.emit('close');
  }.bind(this);

  /**
   * Push a message received on the ws client as an object to the stream.
   *
   * @method onWsMessage
   * @private
   * @param {String} msg a JSON-encoded message received on the ws client
   */
  this.onWsMessage = function onWsMessage(msg) {
    this.log({ evt: 'wsMessage', msg: msg });

    try {
      msg = JSON.parse(msg);
    } catch(err) {
      this.emit('error', new Error('Client sent invalid JSON'));
      return;
    }

    this.push(msg);
  }.bind(this);

  /**
   * Handle the stream ending by closing the ws client connection.
   *
   * @method onStreamEnd
   * @private
   */
  this.onStreamEnd = function onStreamEnd() {
    this.log({ evt: 'streamEnd' });
    this.ws.close(1000);
  }.bind(this);

  /**
   * Handle a stream error by closing the ws client connection.
   *
   * @method onStreamError
   * @private
   * @param {Error} err the error emitted on the stream
   */
  this.onStreamError = function onStreamError(err) {
    this.log({ evt: 'streamError', err: err.message });
    this.ws.close(1008, err.message);
  }.bind(this);

  this.ws.on('close',   this.onWsClose);
  this.ws.on('message', this.onWsMessage);

  this.on('error', this.onStreamError);
  this.on('end',   this.onStreamEnd);

  if (options.keepAlive) {
    this.keepAliveInterval = setInterval(this.keepAlive, options.keepAlive);
  }
}

inherits(ShareJSStream, Duplex);

/**
 * If `debug` is true, log a message.
 *
 * @method log
 * @private
 * @param {Object} msg the message object to log
 */
ShareJSStream.prototype.log = function log(msg) {
  if (this.debug) {
    this.logger.log(msg);
  }
};

/**
 * A no-op read operation for the stream.
 *
 * This is a no-op because _write immediately messages the ws client, rather
 * than pushing the message into a queue.
 *
 * @method _read
 * @private
 */
ShareJSStream.prototype._read = function _read() {
  // no-op
};

/**
 * Write a message to the stream, JSON-encoding it first.
 *
 * @method _write
 * @private
 * @param {Object} msg a message to be written to the stream
 * @param {String} encoding the encoding type (ignored)
 * @param {Function} cb a callback called when the `msg` is written
 */
ShareJSStream.prototype._write = function _write(msg, encoding, cb) {
  msg = JSON.stringify(msg);
  this.ws.send(msg);
  cb();
};

module.exports = ShareJSStream;
