/**
 * lib-v8debug - A V8 Debugger wrapper
 *
 * @copyright 2010, Ajax.org Services B.V.
 * @author Fabian Jakobs <fabian AT ajax DOT org>
 * @author Mike de Boer <mike AT ajax DOT org>
 */

define(function(require, exports, module) {
"use strict";

exports.byteLength = function(str) {
    // returns the byte length of an utf8 string
    var s = str.length;
    for (var i = str.length - 1; i >= 0; i--) {
        var code = str.charCodeAt(i);
        if (code > 0x7f && code <= 0x7ff) s++;
        else if (code > 0x7ff && code <= 0xffff) s += 2;
        if (code >= 0xDC00 && code <= 0xDFFF) i--; // trail surrogate
    }
    return s;
};

exports.readBytes = function(str, start, bytes) {
    // returns the byte length of an utf8 string
    var consumed = 0;
    for (var i = start; i < str.length; i++) {
        var code = str.charCodeAt(i);
        if (code < 0x7f) consumed++;
        else if (code > 0x7f && code <= 0x7ff) consumed += 2;
        else if (code > 0x7ff && code <= 0xffff) consumed += 3;
        if (code >= 0xD800 && code <= 0xDBFF) i++; // leading surrogate
        if (consumed >= bytes) { i++; break; }
    }
    return { bytes: consumed, length: i - start };
};

exports.inherits = (function() {
    var tempCtor = function() {};
    return function(ctor, superCtor) {
        tempCtor.prototype = superCtor.prototype;
        ctor.super_ = superCtor.prototype;
        ctor.prototype = new tempCtor();
        ctor.prototype.constructor = ctor;
    }
}());

exports.mixin = function(obj, mixin) {
    for (var key in mixin)
        obj[key] = mixin[key];
};

exports.implement = function(proto, mixin) {
    exports.mixin(proto, mixin);
};

var EventEmitter = {};

EventEmitter._emit =
EventEmitter.emit =
EventEmitter._dispatchEvent = function(eventName, e) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners || !listeners.length)
        return;

    var e = e || {};
    e.type = eventName;

    for (var i = listeners.length - 1; i >= 0; i--)
        listeners[i](e);
};

EventEmitter.on =
EventEmitter.addEventListener = function(eventName, callback) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        var listeners = this._eventRegistry[eventName] = [];

    if (listeners.indexOf(callback) == -1)
        listeners.push(callback);
};

EventEmitter.removeListener =
EventEmitter.removeEventListener = function(eventName, callback) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
      return;

    var index = listeners.indexOf(callback);
    if (index !== -1)
        listeners.splice(index, 1);
};

EventEmitter.removeAllListeners = function(eventName) {
    if (this._eventRegistry)
        this._eventRegistry[eventName] = [];
};

exports.EventEmitter = EventEmitter;

});
