define(['link'], function(Link) {
    // Inbox Module
    // ============
    // pulls messages from multiple services and renders them in an inbox GUI
    var Inbox = function(structure, config) {
        this.structure = structure;
        this.uri = config.uri;
        this.services = config.services;
        // Prep the structure
        for (var slug in this.services) {
            this.serviceCount++;
            this.services[slug].messagesLink = { uri:'#inbox/services/'+slug, accept:'application/json' };
        }
    };

    // Handler Routes
    // ==============
    Inbox.prototype.routes = [
        Link.route('mainInbox', { uri:'^/?$', method:'get', accept:'html' }),
        Link.route('serviceInbox', { uri:'^/services/([^/]+)/?$', method:'get', accept:'html' })
    ];

    // Resource Handlers
    // =================
    Inbox.prototype.mainInbox = function _mainInbox() {
        // Promise to respond after the services all sync
        var promise = new Link.Promise();
        var responsesLeft = 0;
        // Get messages from all services
        var allMessages = [];
        for (var slug in this.services) {
            responsesLeft++;
            // Capture the service in a closure
            (function(self, service) {
                self.structure.get(service.messagesLink).then(function(response) {
                    // Cache
                    if (response.code == 200) {
                        service.messages = response.body;
                        allMessages = allMessages.concat(service.messages);
                    }
                    if (--responsesLeft == 0) {
                        // Render response
                        var body = {
                            _scripts:{ onrender:__inboxRespRender },
                            _data:{ messages:allMessages, uri:this.uri },
                            childNodes:['<table class="table table-condensed"></table>']
                        };
                        promise.fulfill(Link.response(200, body, 'application/html+json'));
                    }
                }, self);
            })(this, this.services[slug]);
        }
        if (responsesLeft == 0) { return Link.response(204); }
        return promise;
    };
    Inbox.prototype.serviceInbox = function _serviceInbox(request, match) {
        // Get the service
        var service = this.services[match.uri[1]];
        if (!service) { return Link.response(404); }
        
        // Dispatch for messages
        var promise = new Link.Promise();
        this.structure.get(service.messagesLink).then(function(response) {
            // Cache
            if (response.code == 200) { this.messages = response.body; }
            // Render & respond
            return; // :TODO:
            //var inboxView = new Views.Inbox('todo'); //:TODO:
            //inboxView.addMessages(service.messages);
            //promise.fulfill(Link.response(200, inboxView.toString(), 'text/html'));
        }, service);
        return promise;
    };

    // Helpers
    // =======
    function __inboxRespRender(elem, env) {
        if (!this._data.messages) { return; }
        var table = elem.getElementsByTagName('table')[0];
        if (!table) { throw "<table> not found"; }
        // Sort by date
        this._data.messages.sort(function(a,b) { return ((a.date.getTime() < b.date.getTime()) ? 1 : -1); });
        // Render to html
        var html = '';
        for (var i=0; i < this._data.messages.length; i++) {
            var m = this._data.messages[i];
            var md = new Date(m.date).toLocaleDateString() + ' @' + new Date(m.date).toLocaleTimeString();
            html += '<tr><td><span class="label">'+m.service+'</span></td><td><a href="'+m.uri+'">'+m.summary+'</a></td><td>'+md+'</td></tr>';
        }
        // Add to DOM
        table.innerHTML = html;
    }

    return Inbox;
});