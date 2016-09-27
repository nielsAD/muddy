Muddy
=====

Muddy is a  moderator bot for Twitch with support for Discord configuration and logging.

For every moderator action (ban, timeout, change of chat mode), Muddy will send a message to a predefined Discord channel with a snapshot of the chatroom at that moment. For example:

```
Muddy-bot Log
-------------
  Channel: #TwitchChannel
  Date:    Thu Sep 22 2016 17:09:20 GMT+0200 (CEST)
  Action:  Spammer was timed out for 10s (reason)
  Mods:    moobot, Muddy, nielsAD

Chat
----
  60s ago   nielsAD   Regular chat message Kappa
  19s ago   Spammer   SPAM SPAM
```

Features
--------
* Seamless integration between Discord and Twitch; allow commands to be used from both portals.
* Log all moderator actions (`ban`/`timeout`/`unban`/`clear`/`slow`/`emoteonly`/`r9kbeta`/`subscribers`).
* Use the Twitch PubSub API to get more information on events (e.g. moderator who performed the action), fall back to chat API when unavailable.
* Control multiple Twitch channels from a single Discord channel.
* Optionally allow configuration by Twitch moderators and/or a specific Discord role.
* Support for support commands
  * `!uptime` Get the duration of the stream until now
  * `!time` Get the local time of the streamer
  * `!lastseen` Show what a user said last and when it was said
  * `!winner` Pick a random person from chat
* Support for simple commands with
  * Customizable response
  * Customizable repetition timer
  * Customizable amount of cooldown time
  * Customizable amount of cooldown chat lines
  * Customizable amount of response chance

Setup
-----
1. Make sure `nodejs` and `npm` are installed.
3. Install dependencies by executing `npm install` inside the Muddy directory.
4. Rename `config.json.example` to `config.json` and fill in Twitch/Discord/Channel details.
5. Make sure your Twitch bot has moderator rights and you Discord bot has `Write Message`/`Upload File` rights for the channel.
6. Run using `node muddy.js`.
7. Stop Muddy by sending a `SIGINT` (`ctrl+c`).
