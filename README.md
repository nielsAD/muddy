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

Setup
-----
1. Make sure `nodejs` and `npm` are installed.
3. Install dependencies by executing `npm install` inside the Muddy directory.
4. Rename `config.json.example` to `config.json` and fill in Twitch/Discord/Channel details.
5. Make sure your Twitch bot has moderator rights and you Discord bot has `Write Message`/`Upload File` rights for the channel.
6. Run using `node muddy.js`.
7. Stop Muddy by sending a `SIGINT` (`ctrl+c`).
