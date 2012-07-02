/*
Example:
  apps/foo [ json ] post --pragma="no-cache" convert [ xml ] post apps/bar

command      = request { content-type [ request ] } .
request      = [ method ] uri { header-flag } .
header-flag  = [ "-" | "--" ] header-key "=" header-value .
content-type = "[" [ token | string ] "]" .
method       = token .
header-key   = token .
header-value = token | string .
uri          = chars
string       = '"' { token } '"'
*/
define(['lib/linkregistry', 'link'], function(LinkRegistry, Link) {
    // CLI
    // ===
    // Run HTTP requests in the command line
    var CLI = function(structure, elem_id, config_links) {
        this.elemInput = document.getElementById(elem_id);
        this.structure = structure;
    };

    // Route handlers
    // ==============
    CLI.prototype.routes = [
        Link.route('commandHandler', { uri:'^/?$', method:'post' })
    ];
    CLI.prototype.commandHandler = function(request, match, structure) {
        //this.parser.logging = true;
        var body = request.body;
        var promise = new Link.Promise();
        
        // Make sure we got something
        if (!body || !body.cmd) { return Link.response(205); }

        // Clear the input
        this.elemInput.value = '';

        // Dispatch helper
        var self = this;
        var dispatch = function(req, handler) {
            // Replace any link aliases
            req.uri = LinkRegistry.replace(req.uri);
            // Send through the structure
            self.structure.dispatch(req, function(res) {
                res['content-location'] = req.uri; // set the content-location, so the final response goes to that and not the cli uri
                handler(res);
            });
        };
            
        // Parse
        try { var cmd_requests = this.parse(body.cmd); }
        catch(e) {
            var res = Link.response(400, 0, 0, { reason:e.toString() });
            self.structure.dispatch({ uri:'#hist', method:'post', 'content-type':'obj', body:{ cmd:body.cmd, response:res }}, function() {
                self.structure.dispatch({ uri:'#hist', method:'get', accept:'text/html' }, function(response) {
                    // Get HTML out of the response
                    document.getElementById('lshui-hist').innerHTML = response.body.toString();
                });
            });
            return Link.response(204);
        }
        var request_count = cmd_requests.length;
        var cur_request = null;

        // Default the last request to accept html if no type is given
        if (!cmd_requests[cmd_requests.length - 1].accept) {
            cmd_requests[cmd_requests.length - 1].accept = 'text/html';
        }
            
        // Execute with piping
        var handleResponse = function(res) {
            // If failed, break the chain
            if (res.code >= 400 || res.code == 0) {
                // Respond now
                promise.fulfill(res);
                // Highlight the offending command, if multiple exist
                if (request_count > 1) {
                    body.cmd = body.cmd.replace(cur_request.cli_cmd, '<strong>'+cur_request.cli_cmd+'</strong>');
                }
                // Send to history
                self.structure.dispatch({ uri:'#hist', method:'post', 'content-type':'obj', body:{ cmd:body.cmd, response:res }}, function() {
                    self.structure.dispatch({ uri:'#hist', method:'get', accept:'text/html' }, function(response) {
                        // Get HTML out of the response
                        document.getElementById('lshui-hist').innerHTML = response.body.toString();
                    });
                });
            } else {
                // Succeeded, continue the chain
                if (cmd_requests.length) {
                    cur_request = cmd_requests.shift();
                    cur_request.body = res.body;
                    cur_request['content-type'] = res['content-type'];
                    dispatch(cur_request, handleResponse);
                } else {
                    // No more, respond
                    promise.fulfill(res);
                    // Send to history
                    self.structure.dispatch({ uri:'#hist', method:'post', 'content-type':'obj', body:{ cmd:body.cmd, response:res }}, function() {
                        self.structure.dispatch({ uri:'#hist', method:'get', 'accept':'text/html' }, function(response) {
                            // Get HTML out of the response
                            document.getElementById('lshui-hist').innerHTML = response.body.toString();
                        });
                    });
                }
            }
        };
        dispatch((cur_request = cmd_requests.shift()), handleResponse);
        return promise;
    };

    // Parser
    // ======
    CLI.prototype.parse = function(buffer) {
        this.parser.buffer = buffer;
        this.parser.trash = '';
        this.parser.buffer_position = 0;
        return this.parser.readCommand();
    };
    CLI.prototype.parser = { buffer:null, trash:null, buffer_position:0, logging:false };
    CLI.prototype.parser.readCommand = function() {
        // command = request { content-type [ request ] } .
        // ================================================
        var requests = [], curMimeType, defaultMethod = 'get';
        this.log = ((this.logging) ? (function() { console.log.apply(console,arguments); }) : (function() {}));
        this.log('>> Parsing:',this.buffer);
        // Read requests, expecting mimetypes before each extra one
        while (true) {
            // Read request
            request = this.readRequest();
            if (!request) { break; }

            // Default request method
            if (!request.method) {
                request.method = defaultMethod;
                this.log('Set request to default: ', defaultMethod);
            }
            
            // If previously given a mimetype, use it to describe the body of this request
            if (curMimeType) {
                request['content-type'] = curMimeType;
                this.log('Set content-type to ', curMimeType);
            }
            
            // Add to chain
            requests.push(request);
            
            // Read content type
            curMimeType = this.readContentType();

            // Use to describe the expected response body
            if (curMimeType) {
                requests[requests.length - 1].accept = curMimeType;
                this.log('Set accept to', curMimeType);
            }

            // Switch default to POST from here on out
            defaultMethod = 'post';
        }
        if (requests.length == 0) {
            throw "Expected request";
        }
        this.log('<< Finished parsing:', requests);
        return requests;
    };
    CLI.prototype.parser.readRequest = function() {
        // request = [ method ] uri { header-flag } .
        // ==========================================
        var targetUri = false, method = false, headers = {}, start_pos;
        start_pos = this.buffer_position;
        // Read till no more request features
        while (true) {
            var headerSwitch = this.readHeaderSwitch();
            if (headerSwitch) {
                // shouldn't come before method & uri
                if (!targetUri && !method) { throw "Unexpected header flag '" + headerSwitch + "'"; }
                headers[headerSwitch.key] = headerSwitch.value;
                continue;
            }
            var string = this.readNonSpaces();
            if (string) {
                // no uri, assume that's what it is
                if (!targetUri) { targetUri = string; }
                else if (!method) {
                    // no method, the first item was actually the method and this is the uri
                    method = targetUri;
                    targetUri = string;
                } else {
                    throw "Unexpected token '" + string + "'";
                }
                continue;
            }
            break;
        }
        // Return a request if we got a URI; otherwise, no match
        if (!targetUri) { return false; }
        var request = headers;
        request.method = method;
        request.uri = targetUri;
        Object.defineProperty(request, 'cli_cmd', { value:this.trash.substring(start_pos) });
        this.log(request);
        return request;
    };
    CLI.prototype.parser.readContentType = function() {
        // content-type = "[" [ token | string ] "]" .
        // ===========================================
        var match;
        
        // match opening bracket
        match = /^\s*\[\s*/.exec(this.buffer);
        if (!match) { return false; }
        this.moveBuffer(match[0].length);
        
        // read content-type
        match = /^[\w\/\*.0-9]+/.exec(this.buffer);
        var contentType = (!!match ?  match[0] : null);
        //if (!match) { throw "Content-type expected"; }
        contentType && this.moveBuffer(contentType.length);
        
        // match closing bracket
        match = /^\s*\]\s*/.exec(this.buffer);
        if (!match) { throw "Closing bracket ']' expected after content-type"; }
        this.moveBuffer(match[0].length);

        this.log('Read mimetype:', contentType);
        return contentType;
    };
    CLI.prototype.parser.readHeaderSwitch = function() {
        // header-flag = [ "-" | "--" ] header-key "=" header-value .
        // ================================================
        var match, headerKey, headerValue;
    
        // match switch
        match = /^\s*-[-]*/.exec(this.buffer);
        if (!match) { return false; }
        this.moveBuffer(match[0].length);

        // match key
        headerKey = this.readToken();
        if (!headerKey) { throw "Header name expected after '--' switch."; }

        // match '='
        match = /^\s*\=\s*/.exec(this.buffer);
        if (match) {
            // match value
            this.moveBuffer(match[0].length);
            headerValue = this.readString() || this.readToken();
            if (!headerValue) { throw "Value expected for --" + headerKey; }
        } else {
            // default value to `true`
            headerValue = true;
        }
        
        var header = { key:headerKey, value:headerValue };
        this.log('Read header:', header);
        return header;
    };
    CLI.prototype.parser.readNonSpaces = function() {
        // read pretty much anything
        var match = /^(\S*)/.exec(this.buffer);
        if (match) { 
            this.moveBuffer(match[0].length);
            this.log('Read uri:', match[0]);
            return match[0];
        }

        return false;
    };
    CLI.prototype.parser.readString = function() {
        var match;
        
        // match opening quote
        match = /^\s*[\"]/.exec(this.buffer);
        if (!match) { return false; }
        this.moveBuffer(match[0].length);

        // read the string till the next quote
        var string = '';
        while (this.buffer.charAt(0) != '"') {
            var c = this.buffer.charAt(0);
            this.moveBuffer(1);
            if (!c) { throw "String must be terminated by a second quote"; }
            string += c;
        }
        this.moveBuffer(1);

        this.log('Read string:', string);
        return string;
    };
    CLI.prototype.parser.readToken = function() {
        // read the token
        var match = /^\s*([\w]*)/.exec(this.buffer);
        if (!match) { return false; }
        this.moveBuffer(match[0].length);
        this.log('Read token:', match[1]);
        return match[1];
    };
    CLI.prototype.parser.moveBuffer = function(dist) {
        this.trash += this.buffer.substring(0, dist);
        this.buffer = this.buffer.substring(dist);
        this.buffer_position += dist;
        this.log('+', dist);
    };
    
    return CLI;
});
