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
twitch.on("chat",   onMessage);
twitch.on("notice", (chan, id, msg) => console.log(`[TWITCH] notice: ${id} "${msg}"`));


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

	const name = `log${now.toISOString().replace(/[^\d]/g, "")}.txt`;
	const log  = Buffer.from(
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

	const target = discord.readyTime && discord.channels.get(conf.channels[chan]);
	if (target)
		target.sendFile(log, name, `[${chan}] ${action}`).catch( (err) => {
			console.log(`[DISCORD] ${err.message}`);
			console.error(log.toString());
		});
	else
		console.error(`[DISCORD] Channel unavailable ("${log.toString()}")`);
}

twitch.on("ban",     (chan, user, reason)      => onAction(chan, `${user} was banned (${reason || "No reason given"})`));
twitch.on("timeout", (chan, user, reason, len) => onAction(chan, `${user} was timed out for ${len} seconds (${reason || "No reason given"})`));
twitch.on("clearchat",   (chan)                => onAction(chan, "Chat was cleared"));
twitch.on("emoteonly",   (chan, on)            => onAction(chan, `Emote-only mode ${on?"enabled":"disabled"}`));
twitch.on("r9kbeta",     (chan, on)            => onAction(chan, `R9K mode ${on?"enabled":"disabled"}`));
twitch.on("slowmode",    (chan, on, len)       => onAction(chan, `Slow mode (${len}) ${on?"enabled":"disabled"}`));
twitch.on("subscribers", (chan, on)            => onAction(chan, `Subscribers mode ${on?"enabled":"disabled"}`));


twitch.on("connecting",   (addr, port) => console.log(`Connecting to Twitch (${addr}:${port})`));
twitch.on("connected",    (addr, port) => console.log(`Connected to Twitch (${addr}:${port})`));
twitch.on("logon",        ()           => console.log(`Logged in to Twitch.`));
twitch.on("disconnected", (reason)     => console.log(`Disconnected from Twitch (${reason})`));
twitch.on("reconnect",    ()           => console.log("Reconnecting to Twitch"));

discord.on("ready",        ()    => console.log(`Connected to Discord`));
discord.on("reconnecting", ()    => console.log(`Reconnecting to Discord`));
discord.on("error",        (err) => console.log(`[DISCORD] ${err.message}`));

let twitch_conn  = twitch.connect();
let discord_conn = discord.login(conf.discord.identity.token || conf.discord.identity.email, conf.discord.identity.password);

process.on("SIGINT", () => {
	console.log("SIGINT received. Disconnecting..");
	clearInterval(twitch_chat_interval);
	twitch_conn.then(() => twitch.disconnect());
	discord_conn.then(() => discord.destroy());
});

