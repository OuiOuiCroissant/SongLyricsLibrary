const express = require('express');
// const http = require('http');
const path = require('path');
const request = require('request');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const api = require('genius-api');
const session = require('express-session');
// const WebSocket = require('ws');
const MongoStore = require('connect-mongo')(session);
const mongoose = require('mongoose');
const cheerio = require('cheerio');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// const createUser = require('./features/database/create_user.js');
// const getUsernameCookie = require('./features/database/get_username_cookie.js');
const user_schema = require('./features/database/user_schema.js');
// const port = 5000;
// const server = new WebSocket.Server({ port });

const app = express();

const server = app.listen((process.env.PORT || 3000), function(){
  console.log('Express:3000');
});


app.use(express.json());

app.use(express.static(path.join(__dirname)));
app.use(express.static('public'));

app.use('/', express.static(__dirname + '/scripts'));

app.use(bodyParser.urlencoded({extended: true}));

app.use(passport.initialize());

app.use(passport.session());

app.set('trust proxy', 1)

const Listener = mongoose.model('Listener', user_schema, 'Listeners');
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true });

app.use(session({
  secret: 'VlasenkoSecret',
  key: 'sid',
  resave: true,
  saveUninitialized:true,
  store: new MongoStore({mongooseConnection: mongoose.connection})
}));

passport.serializeUser(function(user, done) {
  done(null, user._id);
});

passport.deserializeUser(function(id, done) {
  Listener.findById(id, function(err, user) {
    done(err, user);
  });
});

const isValidPassword = function(user, password){
  return bcrypt.compareSync(password, user.password);
}

const createHash = function(password){
  return bcrypt.hashSync(password, bcrypt.genSaltSync(10), null);
}

passport.use('login', new LocalStrategy({
    passReqToCallback : true
  },
  function(req, username, password, done) {
    Listener.findOne({ username :  username },
      function(err, user) {
        if (err)
          return done(err);
        if (!user){
          console.log(`User Not Found with username ${username}`);
          return done(null, false,
                req.flash('message', 'User Not found.'));
        }
        if (!isValidPassword(user, password)){
          console.log('Invalid Password');
          return done(null, false,
              req.flash('message', 'Invalid Password'));
        }
        return done(null, user);
      }
    );
}));



passport.use('signup', new LocalStrategy({
    passReqToCallback : true
  },
  function(req, username, password, done) {
    findOrCreateUser = function(){
      Listener.findOne({ username: username }, function(err, user) {
        if (err){
          console.log(`Error in SignUp: ${err}`);
          return done(err);
        }
        if (user) {
          console.log('User already exists');
          return done(null, false,
             req.flash('message','User Already Exists'));
        } else {
          let newListener = new Listener();

          newListener.username = username;
          newListener.password = createHash(password);

          newListener.save(function(err) {
            if (err){
              console.log(`Error in Saving user: ${err}`);
              throw err;
            }
            console.log('User Registration succesful');
            return done(null, newListener);
          });
        }
      });
    };

    process.nextTick(findOrCreateUser);
  })
);

const isAuthenticated = (req, res, next) => {
  if (!req.session.passport) { res.redirect('/login'); }
  else if (req.session.passport.user) { return next(); }
}

const deleteSession = (req, res, next) => {
  req.logOut();
  req.session.destroy();
  return next();
}

app.use((req, res, next) => {
  req.session.numberOfVisits = req.session.numberOfVisits + 1 || 1;

  // getUsernameCookie(req.body.username);
  // req.session.username = req.body.username || 'guest';

  console.log(req.session);
  next();
});


app.set('view engine', 'ejs');

const genius = new api(process.env.GENIUS_ACCESS_TOKEN);

// server.on("connection", ws => {
//   console.log('user connected');
//   // ws.send(__dirname + 'index_main.ejs');
//
// });

const http = require('http').createServer(app)
const io = require('socket.io')(server);
// const server = http.createServer(app);
// const io = require('socket.io').listen(server);
// http.listen(3001, () => {
//   console.log('http: 3001');

let clickCount;
io.on('connection', client => {
  console.log('connected');
  client.emit('buttonUpdate', clickCount);
    client.on('clicked', data => {
    	  clickCount++;
		  //send a message to ALL connected clients
      console.log(data);
    }, 3002);
});
// });

app.get('/', (req, res) => {
  let songList = [];

  function createSongList (search) {
    genius.search(search).then(function(response) {
      for (let key of Object.keys(response.hits)) {
        let songListToPush = {
          songName: response.hits[key].result.title,
          singer: response.hits[key].result.primary_artist.name,
          id: response.hits[key].result.id
        }
        songList.push(songListToPush);
      }
      res.render('index_main', { songList: songList });
      return songList;
    });
  }
  createSongList(req.query.search);

  //const ws = new WebSocket('ws://localhost:5000');
});

app.get('/song/:id', (req, res) => {

  let mediaData = {
    songName: String(),
    singer: String(),
    album: String(),
    image: String(),
    lyrics: String()
  }

  genius.song(req.params.id).then(function(response) {
    mediaData = {
      songName: response.song.title,
      singer: response.song.primary_artist.name,
      album: response.song.album.name,
      image: response.song.song_art_image_url,
    }

    function getFull(id, callback) {
      request.get(response.song.url, function(
        error,
        response,
        data
      ) {
        const $ = cheerio.load(data);
        let song = $('.lyrics')
        .text()
        .trim();
        mediaData.lyrics = song;
        res.render('index_song_page', {mediaData: mediaData})
      });
    }
    getFull();
  });
});

app.post('/song', (req, res) => {
  if (!req.session.passport) {
    res.redirect('/login');
  } else {
    res.redirect('/library');
  }
});

app.get('/library', isAuthenticated, (req, res) => {
  res.render('index_lib', { user: req.user })
});


app.get('/login', (req, res) => {
  res.render('index_signup')
});

app.post('/login', passport.authenticate('login', {
  successRedirect: '/library',
  failureRedirect: '/login',
  failureFlash: true
}));

app.get('/signout', deleteSession, (req, res) => {
  res.redirect('/login');
});

app.get('/about', (req, res) => {
  res.render('index_about')
});