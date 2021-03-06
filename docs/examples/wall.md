apps/social/wall.js
===================

pfraze 2013


## Overview

Wall illustrates a fairly simple but common kind of application: a UI proxy. It breaks its interface into multiple `<output>` regions, allowing it to trigger updates to portions of its interface, and live-updates from its data source (which can be remote).


## wall.js

```javascript
importScripts('/lib/linkjs-ext/responder.js');
importScripts('/lib/linkjs-ext/router.js');
importScripts('/lib/linkjs-ext/broadcaster.js');

var serviceBroadcast = Link.broadcaster();
var wallPostsBroadcast = Link.broadcaster();

var posts = [];
var dataProvider = Link.navigator(app.config.dataSource);
var dataUpdates = Link.subscribe(app.config.dataSource);
dataUpdates.on('update', function(e) {
	// if our provider ever updates, we should redraw the posts
	wallPostsBroadcast.emit('update');
});

var user = null;
var userUpdates = Link.subscribe(app.config.userSource);
userUpdates.on(['subscribe','login','logout'], function(e) {
	user = e.data;
	serviceBroadcast.emit('update'); // let's redraw everything
});

function renderFormHtml(query) {
	return [
		'<label for="wall-content">Write on my wall:',
		'<textarea id="wall-content" name="content" class="span6">',(query.content) ? query.content : '','</textarea><br/>',
		'<p>Submitting as: <span class="persona-ctrl"></span></p>',
		'<button type="submit" class="btn btn-block ', (user) ? '' : 'disabled', '">Submit</button>',
		'<br/>'
	].join('');
}

function renderPostsHtml() {
	if (posts && Array.isArray(posts)) {
		return posts.map(function(post) {
			return [
			'<blockquote>',
				'<p>',post.content,'</p>',
				'<small>',post.author,'</small>',
			'</blockquote>'
			].join('');
		}).join('');
	} else {
		console.log('bad posts data',posts);
		return 'Internal Error :(';
	}
}

function renderHtml(query) {
	switch (query.output) {
		case 'posts':
			return renderPostsHtml();
		case 'all':
			return [
				renderFormHtml(query),
				'<output name="posts" form="wall-posts">',
					renderPostsHtml(),
				'</output>'
			].join('');
		default:
			return [
				'<form action="httpl://', app.config.domain,'" method="post" enctype="application/json">',
					'<output name="all">',
						renderFormHtml(query),
						'<output name="posts" form="wall-posts">',
							renderPostsHtml(),
						'</output>',
					'</output>',
				'</form>',
				'<form id="wall-posts" action="httpl://', app.config.domain,'/posts"></form>'
			].join('');
	}
}

function getPosts(cb) {
	dataProvider.get(
		{ headers:{ accept:'application/json'} },
		function(res) {
			res.on('end', function() { posts = res.body; cb(null, res); });
		},
		function(err) { console.log('failed to retrieve posts', err.message); cb(err); }
	);
}

// request router
app.onHttpRequest(function(request, response) {
	var router = Link.router(request);
	var respond = Link.responder(response);

	// service
	router.p('/', function() {
		// build headers
		var headerer = Link.headerer();
		headerer.addLink('/', 'self current service');
		headerer.addLink('/posts', 'collection', { title:'posts' });

		// render
		router.ma('GET', /html/, function() {
			// fetch posts
			getPosts(function(err, res) {
				if (err) { respond.badGateway().end(); }
				else { respond.ok('html', headerer).end(renderHtml(request.query)); }
			});
		});
		// event subscribe
		router.ma('GET', /event-stream/, function() {
			respond.ok('text/event-stream', headerer);
			serviceBroadcast.addStream(response);
		});
		// post submit
		router.mta('POST', /json/, /html/, function() {
			if (!user) { return respond.unauthorized().end(); }
			// pass on to data-source
			dataProvider.post(
				{ body:request.body, headers:{ 'accept':'application/json', 'content-type':'application/json' }},
				function(res) {
					// success
					res.on('end', function() {
						posts = res.body;
						respond.ok('text/html').end(renderHtml(request.query));
					});
				},
				function(err) { respond.pipe(err.response); }
			);
		});
		router.error(response, 'path');
	});
	// posts service
	router.p(/^\/posts\/?$/, function() {
		// build headers
		var headerer = Link.headerer();
		headerer.addLink('/', 'up via service');
		headerer.addLink('/posts', 'self current collection');

		// render
		router.ma('GET', /html/, function() {
			// fetch posts
			getPosts(function(err, res) {
				if (err) { respond.badGateway().end(); }
				else { respond.ok('html', headerer).end(renderHtml(request.query)); }
			});
		});
		// event subscribe
		router.ma('GET', /event-stream/, function() {
			respond.ok('text/event-stream', headerer);
			wallPostsBroadcast.addStream(response);
		});
		router.error(response, 'path');
	});
	router.error(response);
});
app.postMessage('loaded');
```