"use strict";

const tmi  = require("tmi.js");
const djs  = require("discord.js");
const conf = require("./config.json");

if (!conf.discord  || !conf.discord.identity || !conf.twitch || !conf.channels)
	throw "Invalid config file.";

let discord = new djs.Client(conf.discord.connection);
let twitch  = new tmi.client(Object.assign({}, conf.twitch, {
	channels: Object.keys(conf.channels)
}));

const messages   = Symbol("messages");
const num_seen   = Symbol("num_seen");
const commands   = Symbol("commands");
const moderators = Symbol("moderators");
let twitch_chat = {};

function addChannel(chan) {
	twitch_chat[chan] = {};
	twitch_chat[chan][messages]   = [];
	twitch_chat[chan][num_seen]   = 0;
	twitch_chat[chan][commands]   = {};
	twitch_chat[chan][moderators] = new Set();
}

function addCommand(chan, cmd, say) {
	let time = Number.MIN_SAFE_INTEGER;
	let num  = Number.MIN_SAFE_INTEGER;

	twitch_chat[chan][commands][cmd] = function(force) {
		const now = new Date();
		if (!force && ((now - time) < 7500)) return;

		const idx = twitch_chat[chan][num_seen];
		if (!force && (Math.abs(idx - num) < 11)) return;

		twitch.say(chan, say);
		time = now;
		num  = idx;
	};
}

const twitch_chat_clear = setInterval(() => {
	// Truncate the log to hold only messages from the past 60 seconds
	const threshold = new Date() - 80000;
	for (let c in twitch_chat) {
		twitch_chat[c][messages] = twitch_chat[c][messages].filter( (log) => log[0] > threshold );
	}
}, 15000);

function onMessage(chan, user, msg, self) {
	const count = twitch_chat[chan][num_seen] + 1;
	twitch_chat[chan][messages].push([new Date(), user.username, msg]);
	twitch_chat[chan][num_seen] = count % Number.MAX_SAFE_INTEGER;

	if (msg[0] === "!") {
		const [cmd, ...arg] = msg.split(/\s+/);
		const fun = twitch_chat[chan][commands][cmd.toLowerCase()];
		if (fun)
			fun(/*force = */twitch_chat[chan][moderators].has(user.username));
	}
}
twitch.on("action", onMessage);
twitch.on("chat",   onMessage);
twitch.on("notice", (chan, id, msg) => console.log(`[TWITCH] notice: ${id} "${msg}"`));

twitch.on("mods",  (chan, mods) => {twitch_chat[chan][moderators] = new Set(mods); });
twitch.on("mod",   (chan, mod)  => {twitch_chat[chan][moderators].add(mod); });
twitch.on("unmod", (chan, mod)  => {twitch_chat[chan][moderators].delete(mod); });


function pad(s, w, d=" ") {
	s = String(s);
	return (s.length < w)
		? (d.repeat(w)+s).slice(-w)
		: s;
}

function onAction(chan, action, user) {
	const now = new Date();
	const chat = twitch_chat[chan][messages]
		.map( ([t, u, m]) => `${(user===u)?"*":" "} ${pad(Math.round((now - t)/1000), 2)}s ago   ${pad(u, 25)}:   ${m}`)
		.join("\n");

	const name = `log${now.toISOString().replace(/[^\d]/g, "")}.txt`;
	const log  = Buffer.from(
`Muddy-bot Log
-------------
  Channel: ${chan}
  Date:    ${now.toString()}
  Action:  ${action}
  Mods:    ${[...twitch_chat[chan][moderators]].join(", ")}

Chat
----
${chat}
`, "utf8");

	const target = discord.readyTime && discord.channels.get(conf.channels[chan].discord_log);
	if (target)
		target.sendFile(log, name, `[${chan}] ${action}`).catch( (err) => {
			console.log(`[DISCORD] ${err.message}`);
			console.error(log.toString());
		});
	else
		console.error(`[DISCORD] Channel unavailable ("${log.toString()}")`);
}

twitch.on("ban",     (chan, user, reason)      => onAction(chan, `${user} was banned (${reason || "No reason given"})`, user));
twitch.on("timeout", (chan, user, reason, len) => onAction(chan, `${user} was timed out for ${len} second${len===1?"":"s"} (${reason || "No reason given"})`, user));
twitch.on("clearchat",   (chan)                => onAction(chan, "Chat was cleared"));
twitch.on("emoteonly",   (chan, on)            => onAction(chan, `Emote-only mode ${on?"enabled":"disabled"}`));
twitch.on("r9kbeta",     (chan, on)            => onAction(chan, `R9K mode ${on?"enabled":"disabled"}`));
twitch.on("slowmode",    (chan, on, wait)      => onAction(chan, `Slow mode ${on?"enabled":"disabled"} (${wait} second${wait===1?"":"s"} wait)`));
twitch.on("subscribers", (chan, on)            => onAction(chan, `Subscribers mode ${on?"enabled":"disabled"}`));


twitch.on("connecting",   (addr, port) => console.log(`Connecting to Twitch (${addr}:${port})`));
twitch.on("connected",    (addr, port) => console.log(`Connected to Twitch (${addr}:${port})`));
twitch.on("logon",        ()           => console.log(`Logged in to Twitch.`));
twitch.on("disconnected", (reason)     => console.log(`Disconnected from Twitch (${reason})`));
twitch.on("reconnect",    ()           => console.log("Reconnecting to Twitch"));

discord.on("ready",        ()    => console.log(`Connected to Discord`));
discord.on("reconnecting", ()    => console.log(`Reconnecting to Discord`));
discord.on("error",        (err) => console.log(`[DISCORD] ${err.message}`));

for (let c in conf.channels) {
	addChannel(c);
	for (let cmd in conf.channels[c]) {
		if (cmd[0] === "!")
			addCommand(c, cmd, conf.channels[c][cmd]);
	}
};

let twitch_conn  = twitch.connect();
let discord_conn = discord.login(conf.discord.identity.token || conf.discord.identity.email, conf.discord.identity.password);

process.on("SIGINT", () => {
	console.log("SIGINT received. Disconnecting..");
	clearInterval(twitch_chat_clear);
	twitch_conn.then(() => twitch.disconnect());
	discord_conn.then(() => discord.destroy());
});

