"use strict";

const tmi  = require("tmi.js");
const dio  = require("discord.io");
const conf = require("./config.json");

if (!conf.discord || !conf.twitch || !conf.channels)
	throw "Invalid config file.";

let discord = new dio.Client(conf.discord);
let twitch  = new tmi.client(Object.assign({}, conf.twitch, {
	channels: Object.keys(conf.channels)
}));

let discord_ready = false;
let twitch_ready  = false;

let twitch_chat = {
	//"channel": {
	//	[new Date(), "User1", "Chat history"]
	//]
};

const twitch_chat_interval = setInterval(() => {
	// Truncate the log to hold only messages from the past 60 seconds
	const threshold = new Date() - 60000;
	for (let c in twitch_chat) {
		twitch_chat[c] = twitch_chat[c].filter( (log) => log[0] > threshold );
	}
}, 15000);

function onMessage(chan, user, msg, self) {
	if (!(chan in twitch_chat))
		twitch_chat[chan] = [];
	twitch_chat[chan].push([new Date(), user.username, msg]);
}
twitch.on("action", onMessage);
twitch.on("chat", onMessage);


let twitch_mods = {
	//"channel": new Set()
};

twitch.on("mods", (chan, mods) => {
	twitch_mods[chan] = new Set(mods);
});
twitch.on("mod", (chan, mod) => {
	if (!(chan in twitch_mods))
		twitch_mods[chan] = new Set();
	twitch_mods[chan].add(mod);
});
twitch.on("unmod", (chan, mod) => {
	if (chan in twitch_mods)
		twitch_mods[chan].delete(mod);
});


function onAction(chan, action) {
	const now = new Date();
	const chat = (twitch_chat[chan] || [])
		.map( ([t, u, m]) => `  ${Math.round((now - t)/1000)}s ago	${u}	${m}`)
		.join("\n");
	const log = Buffer.from(
`Muddy-bot Log
-------------
  Channel: ${chan}
  Date:    ${now.toString()}
  Action:  ${action}
  Mods:    ${[...twitch_mods[chan] || []].join(", ")}

Chat
----
${chat}
`, "utf8");

	if (discord_ready)
		discord.uploadFile({
			to: conf.channels[chan],
			file: log,
			filename: `log${now.toISOString().replace(/[^\d]/g, "")}.txt`,
			message: `[${chan}] ${action}`
		}, (err) => {
			if (err) {
				console.log(`[DISCORD ERROR] ${err.statusCode} ${err.statusMessage}`);
				console.error(log.toString());
			}
		});
}

twitch.on("ban",     (chan, user, reason)      => onAction(chan, `${user} was banned (${reason || "No reason given"})`));
twitch.on("timeout", (chan, user, reason, len) => onAction(chan, `${user} was timed out for ${len}s (${reason || "No reason given"})`));
twitch.on("clearchat",   (chan)                => onAction(chan, "Chat was cleared"));
twitch.on("emoteonly",   (chan, on)            => onAction(chan, `Emote-only mode ${on?"enabled":"disabled"}`));
twitch.on("slowmode",    (chan, on, len)       => onAction(chan, `Slow mode (${len}) ${on?"enabled":"disabled"}`));
twitch.on("subscribers", (chan, on)            => onAction(chan, `Subscribers mode ${on?"enabled":"disabled"}`));


twitch.on("connecting",   (addr, port) => console.log(`Connecting to Twitch (${addr}:${port})`));
twitch.on("connected",    (addr, port) => console.log(`Connected to Twitch (${addr}:${port})`));
twitch.on("logon",        ()           => console.log(`Logged in to Twitch.`));
twitch.on("disconnected", (reason)     => console.log(`Disconnected from Twitch (${reason})`));
twitch.on("reconnect",    ()           => console.log("Reconnecting to Twitch"));

discord.on("ready",      ()          => console.log(`Connected to Discord`));
discord.on("disconnect", (err, code) => console.log(`Disconnected from Discord (${code}, ${err || "No message."})`));

twitch.on("connected",    () => twitch_ready  = true);
twitch.on("disconnected", () => twitch_ready  = false);
discord.on("ready",       () => discord_ready = true);
discord.on("disconnect",  () => discord_ready = false);

discord.connect();
discord.on("disconnect", (errMsg, code) => {
	if (discord_ready) {
		// Try to reconnect if this was uncommanded
		console.log("Reconnecting in 5 seconds");
		setTimeout(() => discord.connect(), 5000);
	}
});

let conn = twitch.connect();

process.on("SIGINT", () => {
	console.log("SIGINT received. Disconnecting..");
	conn.then(() => twitch.disconnect());
	clearInterval(twitch_chat_interval);

	discord_ready = false;
	discord.disconnect();
});

