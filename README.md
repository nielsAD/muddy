Muddy
=====

Muddy is a  moderator bot for Twitch with support for Discord configuration and logging.

For every moderator action (ban, timeout, change of chat mode), Muddy will send a message to a predefined discord channel with a snapshot of the chatroom at that moment. For example:

```
Muddy-bot Log
-------------
  Channel: #TwitchChannel
  Date:    Thu Sep 22 2016 17:09:20 GMT+0200 (CEST)
  Action:  spammer was timed out for 10s (reason)
  Mods:    moobot, muddy, nielsad

Chat
----
  60s ago	nielsad	Chat message
  19s ago	spammer	SPAM SPAM
```

Setup
-----
1. Make sure `nodejs` and `npm` are installed
3. Install dependencies by using `npm install` inside the Muddy directory
4. Rename `config.json.example` to `config.json` and fill in Twitch/Discord/Channel details
5. Run using `node muddy.js`
6. Stop by sending a `SIGINT` (`ctrl+c`)
