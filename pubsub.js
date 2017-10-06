"use strict";
// Based on https://github.com/twitchdev/pubsub-samples/blob/master/javascript/main.js

const WebSocket    = require("ws");
const EventEmitter = require("events");

const URL = "wss://pubsub-edge.twitch.tv";
const TIMEOUT_HEARTBEAT  = 1000 * 10;  //ms before connection is considered dead
const TIMEOUT_REQUEST    = 1000 * 30;  //ms before considering a request failed
const INTERVAL_HEARTBEAT = 1000 * 120; //ms between PINGs
const INTERVAL_RECONNECT = 1000 * 5;   //ms to wait before reconnect

// Source: https://www.thepolyglotdeveloper.com/2015/03/create-a-random-nonce-string-using-javascript/
function generate_nonce(length) {
	var text = "";
	var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (var i = 0; i < length; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

Set.prototype.union = function(setB) {
    var union = new Set(this);
    for (var elem of setB) {
        union.add(elem);
    }
    return union;
}

Set.prototype.difference = function(setB) {
    var difference = new Set(this);
    for (var elem of setB) {
        difference.delete(elem);
    }
    return difference;
}

class PubSub extends EventEmitter {
	constructor(auth_token, topics = []) {
		super();

		this.auth_token = auth_token;
		this.topics  = new Set(topics);
		this.pending = {};
	}

	connect() {
		return new Promise( (resolve, reject) => {
			this.once("connected", resolve);
			this._connect();
		});
	}

	_connect() {
		this.emit("connecting");
		this.ws = new WebSocket(URL);

		this.ws.on("open", () => {
			this.heartbeat();
			if (this.topics.size > 0)
				this.listen(this.topics);
			this.emit("connected");
		});
		this.ws.on("error", (err) => {
			this.emit("error", err);
		});
		this.ws.on("close", () => {
			this.reconnect();
		});
		this.ws.on("message", (event) => {
			try {
				event = JSON.parse(event);
			} catch(err) {
				this.emit("error", err);
				return;
			}

			switch(event && event.type) {
				case "PONG":
					clearTimeout(this.hbpong);
					this.hbpong = 0;
					break;

				case "RECONNECT":
					this.reconnect();
					break;

				case "RESPONSE":
					if (event.nonce in this.pending) {
						clearTimeout(this.pending[event.nonce][2]);
						if (event.error)
							this.pending[event.nonce][1](new Error(event.error));
						else
							this.pending[event.nonce][0]();
						delete this.pending[event.nonce];			
					}
					break;

				case "MESSAGE":
					this.emit("message", event.data);

					if (event.data && this.topics.has(event.data.topic)) {
						this.emit(event.data.topic, event.data);
					}
					break;

				default:
					this.emit("error", new Error(`[PUBSUB] Invalid message type ${event && event.type}`));
			}
		});
	}

	reconnect() {
		if (!this.ws) return;

		this.disconnect();

		this.emit("reconnect");
		setTimeout(() => this._connect(), INTERVAL_RECONNECT);
	}

	disconnect() {
		this.emit("disconnected");

		if (this.ws) {
			this.ws.removeAllListeners("close");
			this.ws.terminate();
			this.ws = null;
		}

		clearTimeout(this.hbnext);
		clearTimeout(this.hbpong);

		this.hbnext = 0;
		this.hbpong = 0;

		Object.keys(this.pending).forEach( (nonce) => {
			clearTimeout(this.pending[nonce][2]);
			this.pending[nonce][1](new Error("Clear"));
			delete this.pending[nonce];	
		});
	}

	heartbeat() {
			const message = {
				type: "PING"
			};
			this.ws.send(JSON.stringify(message));
			this.hbnext = setTimeout(() => this.heartbeat(), INTERVAL_HEARTBEAT);
			this.hbpong = setTimeout(() => this.reconnect(), TIMEOUT_HEARTBEAT);
	}

	request(type, data = undefined) {
			return new Promise((resolve, reject) => {
				if (!this.ws)
					return reject(new Error("Not connected"));

				const nonce = generate_nonce(18);
				const message = {
					type,
					nonce,
					data
				};
				this.pending[nonce] = [resolve, reject];
				this.pending[nonce][2] = setTimeout(() => {
					if (nonce in this.pending) {
						this.pending[nonce][1](new Error("Request timeout"));
						delete this.pending[nonce];			
					}
				}, TIMEOUT_REQUEST);
				this.ws.send(JSON.stringify(message));
			});
	}

	listen(topics) {
		this.topics = this.topics.union(new Set(topics));
		return new Promise((resolve, reject) => {
			if (this.hbnext)
				this.request("LISTEN", {
					"topics": [...topics],
					"auth_token": this.auth_token
				}).then(resolve, (err) => {
					this.topics = this.topics.difference(new Set(topics));
					reject(err);
				});
			else
				resolve();
		});
	}

	unlisten(topics) {
		return this.request("UNLISTEN", {
			"topics": [...topics],
			"auth_token": this.auth_token
		}).then(() => {
			this.topics = this.topics.difference(new Set(topics));
		});
	}
}

module.exports = {
	client: PubSub
};

