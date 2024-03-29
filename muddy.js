"use strict";

const fs      = require("fs");
const util    = require("util");
const moment  = require("moment-timezone");
const tmi     = require("tmi.js");
const djs     = require("discord.js");
const xjs     = require('express')();
const request = require("request");

const config   = require("./config.json");
const commands = require("./commands.js");
const pubsub   = require("./pubsub.js");

xjs.use( require('body-parser').urlencoded({ extended: true }) );

function error(msg) {
	throw new Error(msg);
}

function pad(s, w, d=" ") {
	s = String(s);
	return (s.length < w)
		? (d.repeat(w)+s).slice(-w)
		: s;
}

function formatDuration(t) {
	let s = Math.round(t / 1000);
	if (s < 60) return `${s} second${s===1?"":"s"}`;
	let m = Math.round(s / 60);
	if (m < 60) return `${m} minute${m===1?"":"s"}`;
	let h = Math.floor(m / 60);
	    m -= h * 60;
	return `${h} hour${h===1?"":"s"} and ${m} minute${m===1?"":"s"}`;
}

function uname(u) {
	if (u && u.username)             return uname(u.username);
	if (Array.isArray(u))            return u.map(uname);
	if (!u || typeof u !== "string") return u;
	if (u.startsWith("@"))
		u = u.slice(1);
	return u.toLowerCase();
}

function twitch_api(opt) {
	const auth = config.twitch.identity.password.startsWith("oauth:")
		? "Bearer " + config.twitch.identity.password.slice(6)
		: undefined;
	return new Promise((resolve, reject) => {
		request(Object.assign({}, opt, {
			method: "GET",
			json: true,
			url: `https://api.twitch.tv/helix/${opt && opt.url && opt.url.replace(new RegExp("^/"), "") || ""}`,
			headers: {
				"Accept":        "application/vnd.twitchtv.v5+json",
				"Client-ID":     config.twitch.identity.clientid,
				"Authorization": auth
			}
		}), (err, res, body) => (err) ? reject(err) : resolve(body && body.data || []));
	});
}

if (!config.api || !config.api.tokens || !config.discord || !config.discord.identity || !config.twitch || !config.twitch.identity || !config.channels)
	error("Invalid config file.");

let discord = new djs.Client(Object.assign(
	{
		api_request_method: "burst",
		messageCacheMaxSize: 1,
		disabledEvents: ["TYPING_START", "PRESENCE_UPDATE"],
		intents: [djs.Intents.FLAGS.GUILDS, djs.Intents.FLAGS.GUILD_MESSAGES]
	},
	config.discord.connection
));

let twitch    = new tmi.client(Object.assign({}, config.twitch));
let twitch_ps = new pubsub.client(config.twitch.identity.password.startsWith("oauth:") ? config.twitch.identity.password.slice(6) : undefined);

let twitch_chat  = {};
let discord_chat = {};

const twitch_owners  = new Set(config.twitch.owners);
const discord_owners = new Set(config.discord.owners);

const newline = "\r\n";
const log_template = [
	"Muddy-bot Log",
	"-------------",
	"  Channel: %s",
	"  Date:    %s",
	"  Action:  %s",
	"  Mods:    %s",
	"",
	"Chat",
	"----",
	"%s",
	""
].join(newline);

class Command_Join extends commands.Command {
	constructor(...args) {
		super(...args);
		this.level = commands.USER_LEVEL.BOT_OWNER;
		this.usage = "[chan]";
	}

	respond(resp, [chan]) {
		if (!chan && this.chat)
			return resp(`Usage: ${this.command} ${this.usage}`);

		chan = String(chan).toLowerCase();
		if (!chan.startsWith("#")) chan = "#"+chan;
		if (twitch_chat[chan]) return;

		TwitchChat.join(chan).then( () => {
			TwitchChat.channel(chan).say("I come from the darkness of the pit.");
		}).catch( (err) => {
			console.log(`[TWITCH] ${err.message || err}`);
			console.log(err.stack);
			resp(`Failed to join "${chan}`);
		});
	}
}

class Command_Leave extends commands.Command {
	constructor(...args) {
		super(...args);
		this.level = commands.USER_LEVEL.BOT_OWNER;
	}

	respond(resp) {
		if (!this.chat) return;
		resp(commands.AFFERMATIVE());
		this.chat.part().catch( (err) => {
			this.chat.muted = true;
			console.log(`[TWITCH] ${err.message || err}`);
			console.log(err.stack);
		});
	}
}

class Command_Uptime extends commands.CustomCommand {
	constructor(...args) {
		super(...args);
		this.description = "Get the duration of the stream up until now";
		this.locked = true;
		this.since  = null;
		this.down   = 1;
		this.rerun  = false;
	}

	enable() {
		super.enable();
		this.update();
		this.uinterval = setInterval( () => this.disabled || this.update(), 30000);
	}

	disable() {
		super.disable();
		this.down = 1;
		if (this.uinterval !== null) {
			clearInterval(this.uinterval);
			this.uinterval = null;
		}
	}

	update() {
		if (!this.chat || !this.chat.chan || !this.chat.chan.startsWith("#")) return;

		return twitch_api({url: `/streams?user_login=${this.chat.chan.slice(1)}`, timeout: 15000})
			.then( (stream) => {
				stream = stream[0];
				if (stream && stream.started_at) {
					const rr = stream.type === "rerun";
					if (this.rerun != rr) {
						this.rerun = rr;
						this.since = new Date(stream.started_at);
					} else {
						// keep old this.since if available to allow restarts
						this.since = this.since || new Date(stream.started_at);
					}
					this.down = 0;
				} else if (this.since && ++this.down >= 30) {
					// 15 minutes to allow the stream to come back
					this.since = null;
				}
			})
			.catch( (err) => {
				console.log(`[TWITCH API] ${err.message || err}`);
				console.log(err.stack);
			});
	}

	respond(resp) {
		const now = new Date();
		resp((this.since && now > this.since)
			? (this.rerun ? "Rerun has been going for " : "Stream has been live for ") + formatDuration(now - this.since)
			: "Stream is offline. Come back later!"
		);
	}
}

commands.GLOBALS["join"]   = Command_Join;
commands.GLOBALS["leave"]  = Command_Leave;
commands.GLOBALS["uptime"] = Command_Uptime;

const MOD_ACTIONS = {
	clear:          Symbol("clear"),
	slow:           Symbol("slow"),
	slowoff:        Symbol("slowoff"),
	emoteonly:      Symbol("emoteonly"),
	emoteonlyoff:   Symbol("emoteonlyoff"),
	r9kbeta:        Symbol("r9kbeta"),
	r9kbetaoff:     Symbol("r9kbetaoff"),
	subscribers:    Symbol("subscribers"),
	subscribersoff: Symbol("subscribersoff"),
	followers:      Symbol("followers"),
	followersoff:   Symbol("followersoff")
};

class TwitchChat {
	constructor(chan, opt = {}) {
		this.chan       = chan;
		this.num_seen   = opt.num_seen   || 0;
		this.messages   = opt.messages   || [];
		this.users      = opt.users      || {};
		this.moderators = opt.moderators || new Set();

		this.no_mod_rights = opt.no_mod_rights || false;
		this.timezone      = opt.timezone      || moment.tz.guess();
		this.muted         = opt.muted         || false;

		this.discord_guild = opt.discord_guild || "";
		this.discord_mods  = opt.discord_mods  || "";
		this.discord_log   = opt.discord_log   || "";

		this.api_tokens = opt.api_tokens || {};

		this.commands = {};
		if (!opt.commands)
			opt.commands = {};

		for (let cmd in commands.GLOBALS) {
			const c = commands.DELIM + cmd;
			this.commands[c] = new commands.GLOBALS[cmd](this, c, opt.commands[c]);
			delete opt.commands[c];
		}
		for (let cmd in opt.commands)
			this.setCommand(cmd, opt.commands[cmd]);
	}

	static channel(chan) {
		return twitch_chat[chan.toLowerCase()] || error(`[TWITCH] Trying to access invalid channel "${chan}"`);
	}

	static get channels() {
		return Object.keys(twitch_chat).map( (c) => twitch_chat[c]);
	}

	static join(chan, opt = {}) {
		let chat = new TwitchChat(chan, opt);
		twitch_chat[chan.toLowerCase()] = chat;
		return twitch.join(chan).then( () => {
			console.log(`[TWITCH] Joined "${chan}"`);

			twitch_api({url: `/users?login=${chan.slice(1)}`}).then( (u) => {
				u = u[0];
				chat.info = u;
				const topic = util.format("chat_moderator_actions.%d.%d", twitch_user.id, u.id);
				twitch_ps.listen([topic])
					.then( () => {
						chat.topic = topic;
						twitch_ps.on(topic, (data) => chat.logActionTopic(data));
					})
					.catch( (err) => console.log(`[TWITCH PubSub] ${topic}: ${err.message || err}`));
			})
			.catch( (err) => {
				console.log(`[TWITCH API] ${err.message || err}`);
				console.log(err.stack);
			});
		}).catch( (err) => {
			delete twitch_chat[chan.toLowerCase()];
		});
	}

	part() {
		if (this.topic) {
			twitch_ps.unlisten([this.topic]).catch( (err) => console.log(`[TWITCH PubSub] ${this.topic}: ${err.message || err}`));;
			twitch_ps.removeAllListeners(this.topic);
		}

		this.discord_guild = "";
		for (let cmd in this.commands)
			this.commands[cmd].disable();

		return twitch.part(this.chan).then( () => {
			delete twitch_chat[this.chan.toLowerCase()];
			console.log(`[TWITCH] Left "${this.chan}"`);
		});
	}

	serialize() {
		let res = {
			no_mod_rights: this.no_mod_rights || undefined,
			timezone:      this.timezone      || undefined,
			muted:         this.muted         || undefined,
			discord_guild: this.discord_guild || undefined,
			discord_mods:  this.discord_mods  || undefined,
			discord_log:   this.discord_log   || undefined,
			api_tokens:    this.api_tokens    || undefined,
			commands:      {}
		};
		for (let cmd in this.commands)
			res.commands[this.commands[cmd].command] = this.commands[cmd].serialize();
		return res;
	}

	static serialize() {
		let res = {};
		this.channels.forEach( (c) => {
			res[c.chan] = c.serialize();
		});
		return res;
	}

	get discord_guild() { return this._discord_guild; }
	set discord_guild(g) {
		if (this.discord_guild)
			discord_chat[this.discord_guild].delete(this);
		if (!g) return;
		if (!(g in discord_chat))
			discord_chat[g] = new Set();
		this._discord_guild = g;
		discord_chat[g].add(this);
	}

	addMessage(user, message, date = new Date()) {
		user = uname(user);
		const msg = [date, user, message]
		this.users[user] = msg;
		this.messages.push(msg);
	}

	truncateMessages(threshold = new Date() - 80000) {
		this.messages = this.messages.filter( (log) => log[0] > threshold );
	}

	onMessage(user, message, self) {
		this.addMessage(user, message);
		if (self || user["user-id"] == twitch_user._id) return;

		this.num_seen = (this.num_seen + 1) % Number.MAX_SAFE_INTEGER;

		if (message.startsWith(commands.DELIM)) {
			const [cmd, ...args] = message.split(/\s+/);
			const command = this.command(cmd);
			if (command) {
				const username = uname(user);
				const user_level = (
					twitch_owners.has(username)              ? commands.USER_LEVEL.BOT_OWNER :
					(this.chan.toLowerCase()==="#"+username) ? commands.USER_LEVEL.CHANNEL_OWNER :
					user.mod && !this.no_mod_rights          ? commands.USER_LEVEL.CHANNEL_MOD :
					user.mod || user.subscriber              ? commands.USER_LEVEL.SUBSCRIBER :
					                                           commands.USER_LEVEL.USER
				);
				command.execute((s) => this.say(s), user_level, args);
			}
		}
	}

	onClear() {
		this.num_seen = 0;
	}

	say(message) {
		return !this.muted && twitch.say(this.chan, message);
	}

	logAction(action, username) {
		username = uname(username);
		const now  = new Date();
		const last = this.users[username];

		if (last)
			if (!last[3] || (now-last[3] > 3000))
				last[3] = now;
			else
				return;
		else
			this.users[username] = [null, username, null, now];

		const chat = this.messages
			.map( ([t, u, m]) => `${(username===u)?"*":" "} ${pad(Math.round((now - t)/1000), 2)}s ago  ${pad(u, 25)}:  ${m}`)
			.join(newline);

		const name = `log${moment(now).tz(this.timezone).format("YYYYMMDD_HHmmss")}.txt`;
		const log  = Buffer.from(
			util.format(log_template,
				this.chan,
				moment(now).tz(this.timezone).format("MMMM Do YYYY, HH:mm:ss z"),
				action,
				[...this.moderators].join(", "),
				(last && last[0] && (!this.messages[0] || this.messages[0][0] > last[0]))
					? `* ${pad(Math.round((now - last[0])/1000), 2)}s ago  ${pad(last[1], 25)}:  ${last[2]}`
					: chat
			),
			"utf8"
		);

		const target = discord.channels.cache.get(this.discord_log);
		if (target)
			target.send({
				content: `[${this.chan}] ${action}`,
				files: [new djs.MessageAttachment(log, name)]
			}).catch( (err) => {
				console.log(`[DISCORD] Failed to send file: ${err.message || err}`);
				console.log(err.stack);
				console.error(log.toString());
			});
		else
			console.error(`[DISCORD] Channel unavailable ("${log.toString()}")`);
	}

	logActionObserver(...args) {
		// Give PubSub a chance to deliver this message
		setTimeout( () => this.logAction(...args), 1500);
	}

	logActionTopic(topic) {
		if (!topic || !topic.message) return;
		const data = (JSON.parse(topic.message) || {}).data;

		if (!data) return;
		if (!data.args) data.args = [];

		let action = undefined;
		let user   = MOD_ACTIONS[data.moderation_action];
		switch(data.moderation_action) {
			case "delete":    action = `${data.created_by} deleted message from ${user=data.args[0]}`; break;;
			case "unban":     action = `${data.created_by} unbanned ${user=data.args[0]}`; break;
			case "ban":       action = `${data.created_by} banned ${user=data.args[0]} (${data.args[1]||"No reason specified"})`; break;
			case "timeout":   action = `${data.created_by} timed out ${user=data.args[0]} for ${data.args[1]} second${data.args[1]==1?"":"s"} (${data.args[2]||"No reason specified"})`; break;
			case "untimeout": return;

			case "clear":          action = `${data.created_by} cleared chat`; break;
			case "slow":           action = `${data.created_by} turned on slow mode (${data.args[0]} second cooldown)`; break;
			case "slowoff":        action = `${data.created_by} turned off slow mode`; break;
			case "emoteonly":      action = `${data.created_by} turned on emote-only mode`; break;
			case "emoteonlyoff":   action = `${data.created_by} turned off emote-only mode`; break;
			case "r9kbeta":        action = `${data.created_by} turned on R9K mode`; break;
			case "r9kbetaoff":     action = `${data.created_by} turned off R9K mode`; break;
			case "subscribers":    action = `${data.created_by} turned on subscribers mode`; break;
			case "subscribersoff": action = `${data.created_by} turned off subscribers mode`; break;
			case "followers":      action = `${data.created_by} turned on followers mode (${data.args.join(" ")} threshold)`; break;
			case "followersoff":   action = `${data.created_by} turned off followers mode`; break;

			case "mod":   this.moderators.add(uname(data.args[0]));    return;
			case "unmod": this.moderators.delete(uname(data.args[0])); return;

			case "automod_rejected":         this.addMessage(data.args[0], `/AUTOMOD/ ${data.args[1]}`); return;
			case "approved_automod_message": return;
			case "denied_automod_message":   return;

			case "add_blocked_term":      return;
			case "add_permitted_term":    return;
			case "delete_blocked_term":   return;
			case "delete_permitted_term": return;

			case "host":   return;
			case "unhost": return;

			default:
				console.log(`[TWITCH PubSub] Unknown moderator action "${data.moderation_action}"`);
				return
		}
		this.logAction(action, user);
	}

	setCommand(cmd, opt) {
		if (!cmd.startsWith(commands.DELIM))
			cmd = commands.DELIM + cmd;

		const c = cmd.toLowerCase();
		if (this.commands[c])
			this.commands[c].disable();
		if (opt)
			if (opt.source)
				return this.commands[c] = new (require(opt.source))(this, cmd, opt);
			else
				return this.commands[c] = new commands.CustomCommand(this, cmd, opt);
		else
			delete this.commands[c];
	}

	command(cmd) {
		let c = cmd.toLowerCase();
		if (!c.startsWith(commands.DELIM))
			c = commands.DELIM + c;
		return this.commands[c];
	}
}

twitch.on("mods",  (chan, mods) => {TwitchChat.channel(chan).moderators = new Set(uname(mods)); });
twitch.on("mod",   (chan, mod)  => {TwitchChat.channel(chan).moderators.add(uname(mod)); });
twitch.on("unmod", (chan, mod)  => {TwitchChat.channel(chan).moderators.delete(uname(mod)); });

twitch.on("action", (chan, user, msg, self) => TwitchChat.channel(chan).onMessage(user, msg, self));
twitch.on("chat",   (chan, user, msg, self) => TwitchChat.channel(chan).onMessage(user, msg, self));
twitch.on("notice", (chan, id, msg) => console.log(`[TWITCH] notice: ${chan} ${id} "${msg}"`));

twitch.on("clearchat", (chan) => TwitchChat.channel(chan).onClear());

twitch.on("ban",            (chan, user, reason)      => TwitchChat.channel(chan).logActionObserver(`${user} was banned (${reason || "No reason given"})`, user));
twitch.on("timeout",        (chan, user, reason, len) => TwitchChat.channel(chan).logActionObserver(`${user} was timed out for ${len} second${len==1?"":"s"} (${reason || "No reason given"})`, user));
twitch.on("messagedeleted", (chan, user, msg, id)     => TwitchChat.channel(chan).logActionObserver(`Deleted message from ${user}`, user));

twitch.on("clearchat",   (chan)           => TwitchChat.channel(chan).logActionObserver("Chat was cleared", MOD_ACTIONS.clear));
twitch.on("emoteonly",   (chan, on)       => TwitchChat.channel(chan).logActionObserver(`Emote-only mode ${on?"enabled":"disabled"}`, on?MOD_ACTIONS.emoteonly:MOD_ACTIONS.emoteonlyoff));
twitch.on("r9kbeta",     (chan, on)       => TwitchChat.channel(chan).logActionObserver(`R9K mode ${on?"enabled":"disabled"}`, on?MOD_ACTIONS.r9kbeta:MOD_ACTIONS.r9kbetaoff));
twitch.on("slowmode",    (chan, on, wait) => TwitchChat.channel(chan).logActionObserver(`Slow mode ${on?"enabled":"disabled"} (${wait} second${wait==1?"":"s"} cooldown)`, on?MOD_ACTIONS.slow:MOD_ACTIONS.slowoff));
twitch.on("subscribers", (chan, on)       => TwitchChat.channel(chan).logActionObserver(`Subscribers mode ${on?"enabled":"disabled"}`, on?MOD_ACTIONS.subscribers:MOD_ACTIONS.subscribersoff));
twitch.on("followersonly", (chan, on)     => TwitchChat.channel(chan).logActionObserver(`Followers-only mode ${on?"enabled":"disabled"}`, on?MOD_ACTIONS.subscribers:MOD_ACTIONS.subscribersoff));

twitch.on("whisper", (frm, user, msg, self) => {
	msg = msg.split(/\s+/);
	if (self || msg.length < 1 || !twitch_owners.has(uname(user))) return;

	const chat = msg[0].startsWith("#") && twitch_chat[msg.shift().toLowerCase()];
	const [cmd, ...args] = msg;
	const command = (chat && chat.command(cmd)) ||
	                (cmd && cmd.toLowerCase() in commands.GLOBALS && new commands.GLOBALS[cmd.toLowerCase()](chat, cmd));

	if (command) {
		command.execute((s) => twitch.whisper(frm, s), commands.USER_LEVEL.BOT_OWNER, args);
	} else {
		twitch.whisper(frm, "Invalid command.")
	}
});

twitch.on("connecting",   (addr, port) => console.log(`Connecting to Twitch (${addr}:${port})`));
twitch.on("connected",    (addr, port) => console.log(`Connected to Twitch (${addr}:${port})`));
twitch.on("logon",        ()           => console.log(`Logged in to Twitch.`));
twitch.on("disconnected", (reason)     => console.log(`Disconnected from Twitch (${reason})`));
twitch.on("reconnect",    ()           => console.log("Reconnecting to Twitch"));

twitch_ps.on("connecting",   () => console.log(`Connecting to Twitch PubSub`));
twitch_ps.on("connected",    () => console.log("Connected to Twitch PubSub"));
twitch_ps.on("disconnected", () => console.log(`Disconnected from Twitch PubSub`));
twitch_ps.on("reconnect",    () => console.log("Reconnecting to Twitch PubSub"));
twitch_ps.on("error",        (err) => console.log(`[PUBSUB] ${err.message || err}`));

discord.on("messageCreate", (m) => {
	if (m.author.bot || m.channel.type !== "GUILD_TEXT" || !m.content.startsWith(commands.DELIM))
		return;

	const chat = discord_chat[m.guild.id];
	if (!chat || chat.size < 1) return;

	const [cmd, ...args] = m.content.split(/\s+/);
	const user  = `${m.author.username}#${m.author.discriminator}`;
	const role  = m.member && Math.max(...[...m.member.roles.cache.values()].map( (r) => r.position ));
	const roles = [...m.guild.roles.cache.values()];

	const owner = discord_owners.has(user.toLowerCase());
	const admin = m.member && m.member.permissions.has(djs.Permissions.FLAGS.ADMINISTRATOR);
	chat.forEach( (c) => {
		const command = c.command(cmd);
		if (!command) return;

		const mod = role >= (roles.find( (r) => r.name === c.discord_mods ) || {}).position;
		const user_level = (
			owner ? commands.USER_LEVEL.BOT_OWNER :
			admin ? commands.USER_LEVEL.CHANNEL_OWNER :
			mod   ? commands.USER_LEVEL.CHANNEL_MOD :
			        commands.USER_LEVEL.USER
		);
		command.execute((s) => !c.muted && m.reply((chat.size > 1 ? `**[${c.chan}]** ` : "") + s), user_level, args, true);
	});
});

discord.on("ready", ()    => {
	console.log(`Connected to Discord`);
	discord.user.setStatus("online");
	discord.user.setActivity("!cmd or !muddyhelp");
});
discord.on("reconnecting", ()    => console.log(`Reconnecting to Discord`));
discord.on("error",        (err) => console.log(`[DISCORD] ${err.message || err}`));


xjs.disable('x-powered-by');
xjs.use( require('body-parser').urlencoded({ extended: true }) );

function process_api(req, res, arg) {
	let chan = String(req.params.chan).toLowerCase();
	if (!chan.startsWith("#")) chan = "#"+chan;
	if (!twitch_chat[chan])
		return res.status(400).json({ error: 'Channel not found' });

	const lvl = config.api.tokens[req.body.token] || twitch_chat[chan].api_tokens[req.body.token] || 0;
	const cmd = String(req.params.cmd);
	const command = twitch_chat[chan].command(cmd);
	if (!command)
		return res.status(400).json({ error: 'Command not found' });

	const timeout = setTimeout(() => res.status(408).json({ error: 'Request timeout' }), 3000);
	command.execute((s) => clearTimeout(timeout) | res.json({ response: s }), lvl, arg, true);
}

xjs.post('/:chan/:cmd/:arg', (req, res) => process_api(req, res, [req.params.arg].concat(String(req.body.arg).split(/\s+/))));
xjs.post('/:chan/:cmd',      (req, res) => process_api(req, res, String(req.body.arg).split(/\s+/)));
xjs.get( '/:chan/:cmd',      (req, res) => process_api(req, res, []));

let twitch_user   = twitch_api({url: "/users"}).then( (u) => twitch_user = u[0] );
let twitch_conn   = twitch.connect();
let twitchps_conn = twitch_ps.connect();
let discord_conn  = discord.login(config.discord.identity.token || config.discord.identity.email, config.discord.identity.password);
let xjs_server    = config.api.port && xjs.listen(config.api.port, () => console.log(`Listening on port ${config.api.port}`));

Promise.all([twitch_user, twitch_conn, twitchps_conn, discord_conn]).then( () => {
	for (let c in config.channels)
		TwitchChat.join(c, config.channels[c]);
});

const twitch_chat_clear = setInterval(() => {
	const threshold = new Date() - 80000;
	TwitchChat.channels.forEach( (c) => c.truncateMessages(threshold) );
}, 15000);

const config_save_clear = function() {
	let last = "";
	return setInterval(() => {
		config.channels = TwitchChat.serialize();
		const conf = JSON.stringify(config, undefined, "\t");
		if (last !== conf) {
			last = conf;
			fs.writeFile("./config.json", conf, (err) => {
				if (err) error(err);
				console.log("Updated config.json");
			});
		}
	}, 60000);
}();

process.on("unhandledRejection", (err) => {
	console.log(`[PROMISE] ${err.message || err}`);
	console.log(err.stack);
});


const disconnect = () => {
	clearInterval(twitch_chat_clear);
	clearInterval(config_save_clear);
	Promise.all(TwitchChat.channels.map( (c) => c.part() )).then( () => {
		twitch_conn.then(() => twitch.disconnect());
		twitchps_conn.then(() => twitch_ps.disconnect());
		discord_conn.then(() => discord.destroy());

		if (xjs_server) {
			xjs_server.close();
		}
	});
};


process.on("SIGINT", () => {
	console.log("SIGINT received. Disconnecting..");
	disconnect();
});

process.on("SIGTERM", () => {
	console.log("SIGTERM received. Disconnecting..");
	disconnect();
});

