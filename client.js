const net = require('net');
const parser = require('./parser');
const render = require('./render');
const images = require('images');

class ResponseParser {
    constructor() {
        this.WAITING_STATUS_LINE = 0;
        this.WAITING_STATUS_LINE_END = 1;
        this.WAITING_HEADER_NAME = 2;
        this.WAITING_HEADER_VALUE = 3;
        this.WAITING_HEADER_SPACE = 4;
        this.WAITING_HEADER_VALUE_LINE_END = 5;
        this.WAITING_HEADER_VALUE_BLOCK_END = 6;
        this.WAITING_BODY = 7;

        this.current = this.WAITING_STATUS_LINE;
        this.statusLine = '';
        this.headers = {};
        this.headerName = '';
        this.headerValue = '';
        this.bodyParser = null;
    }
    get isFinished() {
        return this.bodyParser && this.bodyParser.isFinished;
    }
    get response() {
        this.statusLine.match(/HTTP\/1.1 ([0-9]+) ([\s\S]+)/);
        return {
            statusCode: RegExp.$1,
            statusText: RegExp.$2,
            headers: this.headers,
            body: this.bodyParser.content.join('')
        }
    }
    receive(string) {
        // console.log(string)
        for (let i = 0; i < string.length; ++i) {
            this.receiveChar(string.charAt(i));
        }

    }
    receiveChar(char) {
        //状态机
        if (this.current === this.WAITING_STATUS_LINE) {
            if (char === '\r') {
                this.current = this.WAITING_STATUS_LINE_END;
            } else if (char === '\n') {// 这里要为 else if 否则会在statusCode结尾多出一个\r
                this.current = this.WAITING_HEADER_NAME;
            } else {
                this.statusLine += char;
            }
        } else if (this.current === this.WAITING_STATUS_LINE_END) {
            if (char === '\n') {
                this.current = this.WAITING_HEADER_NAME;
            }
        } else if (this.current === this.WAITING_HEADER_NAME) {
            if (char === ':') {
                this.current = this.WAITING_HEADER_SPACE;
            } else if (char === '\r') {
                this.current = this.WAITING_HEADER_VALUE_BLOCK_END;
                if (this.headers['Transfer-Encoding'] === 'chunked') {
                    this.bodyParser = new TrunkedBodyParser();
                }
            } else {
                this.headerName += char;
            }
        } else if (this.current === this.WAITING_HEADER_SPACE) {
            if (char === ' ') {
                this.current = this.WAITING_HEADER_VALUE;
            }
        } else if (this.current === this.WAITING_HEADER_VALUE) {
            if (char === '\r') {
                this.current = this.WAITING_HEADER_VALUE_LINE_END;
                //会有多行heard line
                this.headers[this.headerName] = this.headerValue;
                this.headerValue = '';
                this.headerName = '';
            } else {
                this.headerValue += char;
            }
        } else if (this.current === this.WAITING_HEADER_VALUE_LINE_END) {
            if (char === '\n') {
                this.current = this.WAITING_HEADER_NAME;
            }
        } else if (this.current === this.WAITING_HEADER_VALUE_BLOCK_END) {
            if (char === '\n') {
                this.current = this.WAITING_BODY;
            }
        } else if (this.current === this.WAITING_BODY) {
            this.bodyParser.receiveChar(char);
        }

    }
}

class TrunkedBodyParser {
    /* chunk  一行数字一行内容，数字表示下面一行内容中的字符个数，当表示
    内容长度的数字内容为时，结束 */
    constructor() {
        this.WAITING_LENGTH = 0;
        this.WAITING_LENGTH_LINE_END = 1;
        this.READING_TRUNK = 2;
        this.WAINTING_NEW_LINE = 3;
        this.WAINTING_NEW_LINE_END = 4;
        this.length = 0;
        this.content = [];//字符串在做加法运算的时候性能会很差
        this.current = 0;
        this.isFinished = false
    }
    receiveChar(char) {
        if (this.current === this.WAITING_LENGTH) {
            if (char === '\r') {
                if (this.length === 0) {
                    this.isFinished = true;
                } else {// 这里要为else 否则本该结束的逻辑会执行到 this.current = this.WAITING_LENGTH_LINE_END，结尾的\r\n\r\n的后\r\n会混进body
                    this.current = this.WAITING_LENGTH_LINE_END;
                }
            } else {
                this.length *= 16;
                this.length += parseInt(char, 16);
            }
        } else if (this.current === this.WAITING_LENGTH_LINE_END) {
            if (char === '\n') {
                this.current = this.READING_TRUNK;
            }
        } else if (this.current === this.READING_TRUNK) {
            this.content.push(char);
            --this.length;
            if (this.length <= 0) {
                this.current = this.WAINTING_NEW_LINE;
            }
        } else if (this.current === this.WAINTING_NEW_LINE) {
            if (char === '\r') {
                this.current = this.WAINTING_NEW_LINE_END;
            }
        } else if (this.current === this.WAINTING_NEW_LINE_END) {
            if (char === '\n') {
                this.current = this.WAITING_LENGTH;
            }
        }
    }
}

class Request {
    constructor(options) {
        this.method = options.method || 'GET';
        this.host = options.host;
        this.port = options.port || 80;
        this.path = options.path || '/';
        this.body = options.body || {};
        this.headers = options.headers || {};
        if (!this.headers['Content-Type']) {
            this.headers['Content-Type'] = 'application/x-form-urlencode';
        }
        if (this.headers['Content-Type'] === 'application/json') {
            this.bodyText = JSON.stringify(this.body);
        } else if (this.headers['Content-Type'] === 'application/x-form-urlencode') {
            this.bodyText = Object.keys(this.body).map(key => `${key}=${encodeURIComponent(this.body[key])}`).join('&');
        }
        this.headers['Content-Length'] = this.bodyText.length;

    }
    toString() {
        return `${this.method} ${this.path} HTTP/1.1\r\nHost: ${this.host}\r\n${Object.keys(this.headers).map((key) => `${key}: ${this.headers[key]}`).join('\r\n')}\r\n\r\n${this.bodyText}`;
    }
    open(method, url) { }
    send(connection) {
        return new Promise((resolve, reject) => {
            const parser = new ResponseParser;
            if (connection) {
                connection.write(this.toString());
            } else {
                connection = net.createConnection({ host: this.host, port: this.port }, () => {
                    connection.write(this.toString());
                })
            }
            connection.on('data', (data) => {
                parser.receive(data.toString());
                if (parser.isFinished) {
                    resolve(parser.response);
                }
                connection.end();
            });
            connection.on('error', (err) => {
                reject(err);
                connection.end();
            })
        })
    }

}

void async function () {
    let request = new Request(
        {
            method: 'POST',
            host: '127.0.0.1',
            port: 8088,
            path: '/',
            headers: {
                ['X-Foo2']: 'bylte2034'
            },
            body: {
                name: 'byl'
            }
        }
    )
    let response = await request.send();

    let dom = parser.parseHTML(response.body);

    let viewport = images(800, 600);

    render(viewport, dom);//对应着c1元素

    viewport.save('viewport.jpg');
    // console.log(response);

    // console.log(JSON.stringify(dom, null, '   '));
}();

class Response {

}