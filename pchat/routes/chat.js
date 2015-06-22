var express = require('express');
var router = express.Router();
var ChatMessage = require('../chatmessage');
var OpenChat = require('../openchat');
var User = require('../user');

/* GET the messages from a specific chat */
router.get('/:id', function(req, res) {
    var sess = req.session;

    OpenChat.findChatInfo(sess.userId, req.params.id, function(err, info) {
        if (err || !info) {
            if (err) console.error(err);
            res.status(500).send('Could not complete request');
            return;
        }

        res.render('chat',
            {   title: info.title,
                username: sess.username,
                pageScript: ['chat.page.js', 'dropzone.page.js'],
                session: sess,
                conversationId: info.conversationId,
                checkpoint: info.checkpoint,
                chatType: info.type,
                partnerId: info.partnerId
            });
    });

});

/**
 * Displays a screen where a user can start a new IM session
 */
router.get('/im/new', function(req, res) {
    var sess = req.session;

    var e = null;
    if (req.query.e == "notfound") {
        e = "Username not found";
    }

    res.render('newim',
        {
            title: 'Send a new Instant Message',
            username: sess.username,
            session: sess,
            error: e
        });
});

router.post('/im/new', function(req, res) {
    var sess = req.session;

    //look up both users involved
    User.findUserByName(req.body.username, function(err, u1) {
        if (err) {
            console.error(err);
            res.status(500).send('Could not complete request');
            return;
        }

        if (u1 == null) {
            //we couldn't find the user
            res.redirect('/chat/im/new?e=notfound');
            return;
        }

        User.resolveUser(sess.userId, function (err, u2) {
            if (err || u2 == null) {
                console.error(err);
                res.status(500).send('Could not complete request');
                return;
            }

            OpenChat.startIM(u1, u2, function(err, chatId) {
                if (err) {
                    console.error(err);
                    res.status(500).send('Could not complete request');
                    return;
                }

                res.redirect('/chat/' + chatId);
            })
        });

    });
});

/**
 * Displays a screen where a user can enter a chat room
 */
router.get('/room/join', function(req, res) {
    var sess = req.session;

    res.render('joinroom',
        {
            title: 'Join a chat room',
            username: sess.username,
            session: sess
        });
});

/**
 * Places the user in this session into the requested room
 */
router.post('/room/join', function(req, res) {
    var sess = req.session;

    OpenChat.joinRoom(req.body.roomname, sess.userId, function(err, conversationId) {
        if (err) {
            console.error(err);
            res.status(500).send('Could not complete request');
            return;
        }

        res.redirect('/chat/' + conversationId);
    });
});

router.get('/recent/:id', function(req, res) {
    var sess = req.session;

    ChatMessage.getRecentChatMessages(req.params.id, sess.userId,
        function (err, messages) {
            if (err) {
                console.error(err);
                res.status(500).send('Could not complete request');
                return;
            }

            //reverse the sorting since it will be newest first
            //coming out of the DB
            var reordered = [];
            for (var i = messages.length - 1; i >= 0; i--) {
                reordered.push(messages[i]);
            }

            //blank out the user's email
            for (var i = 0, len=reordered.length; i < len; i++) {
                messages[i].user.email = null;
                messages[i].user.salt = null;
                messages[i].user.pwHash = null;
            }

            res.json(reordered);
    });
});

router.get('/since/:id/:timestamp', function(req, res) {
    var sess = req.session;

    ChatMessage.getNewChatMessagesSince(req.params.id, req.params.timestamp,
        function (err, messages) {
            if (err) {
                console.error(err);
                res.status(500).send('Could not complete request');
                return;
            }

            //blank out the user's private information
            for (var i = 0, len=messages.length; i < len; i++) {
                messages[i].user.email = null;
                messages[i].user.salt = null;
                messages[i].user.pwHash = null;
            }

            res.json(messages);

            //since this function is frequently called by the client
            //we also use this opportunity to update the last_seen time
            //for the user every few minutes
            var LAST_SEEN_UPDATE_CHANCE = 10; //1 in X chance last_seen will be updated
            if (Math.floor((Math.random() * LAST_SEEN_UPDATE_CHANCE) + 1)
                == LAST_SEEN_UPDATE_CHANCE) {

                User.updateLastSeenTimeToNowIfNecessary(sess.userId, function (err) {
                    if (err) {
                        console.error('Unable to update last seen time: ' + err);
                    }
                });
            }
    });
});

router.post('/add', function(req, res) {
    var sess = req.session;
    var CLEANUP_CHANCE = 10; //1 in X chance a cleanup will run

    var cleanupRoutine = function() {
        if (Math.floor((Math.random() * CLEANUP_CHANCE) + 1) == CLEANUP_CHANCE) {
            ChatMessage.clearExpiredData(req.body.conversationId, function(err) {
                if (err) {
                    console.error(err);
                    res.status(500).send('Could not complete request');
                    return;
                }

                res.json({"status": "ok"});
            });

        } else {
            res.json({"status": "ok"});
        }
    }

    if (req.body.chatText) {
        ChatMessage.postMessage(req.body.conversationId, sess.userId, req.body.chatText,
            function (err) {
                if (err) {
                    console.error(err);
                    res.status(500).send('Could not complete request');
                    return;
                }

                cleanupRoutine();
            }
        );
    } else if (req.body.media) {
        ChatMessage.postMedia(req.body.conversationId, sess.userId, req.body.media,
            function (err) {
                if (err) {
                    console.error(err);
                    res.status(500).send('Could not complete request');
                    return;
                }

                cleanupRoutine();
            }
        );
    } else {
        res.status(400).send('Could not complete request');
        return;
    }

});

router.post('/leave', function(req, res) {
    var sess = req.session;

    OpenChat.leaveChat(req.body.conversationId, sess.userId,
        function (err) {
            if (err) {
                console.error(err);
                res.status(500).send('Could not complete request');
                return;
            }

            res.json({"status": "ok"});
        }
    );
});

router.post('/checkpoint', function(req, res) {
    var sess = req.session;

    OpenChat.setCheckpoint(req.body.conversationId, sess.userId, req.body.checkpoint,
        function (err) {
            if (err) {
                console.error(err);
                res.status(500).send('Could not complete request');
                return;
            }

            res.json({"status": "ok"});
        }
    );
});

router.get('/timestamp/:id', function(req, res) {
    var sess = req.session;

    ChatMessage.getLatestTimestamp(req.params.id, function(err, timestamp) {
        if (err) {
            console.error(err);
            res.status(500).send('Could not complete request');
            return;
        }

        res.json({"timestamp": timestamp});
    });
});


module.exports = router;
