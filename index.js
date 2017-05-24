const { PKG_NAME, PKG_VERSION } = require('./package.json');

const express = require('express');
const wake = require('express-wake');
const rpc = require('express-rpc-beeson');
const local = require('local-rpc');
const got = require('got');

function microbrew(name, module, deps = {}, tracer, debug) {
    const app = express();

    const { middleware: rpcMiddleware, consumeWith } = rpc(module, {debug});
    const serviceCall = (host, method, args, requestData) => {
        const run = consumeWith((url, options) => {
            options.headers = {
                'user-agent': `${PKG_NAME}/${PKG_VERSION}-${name}`,
                'x-wake-request-id': requestData.requestId,
                'x-wake-operation-id': requestData.operationId
            };
            // TODO here is where we can control the retry-on-error logic, after the consumer API is defined
            options.retries = 0;

            return got(url, options);
        });

        return run(host, method, args);
    };

    const { middleware: wakeMiddleware, error: wakeError, decorator: traceFn } = wake(tracer);

    const doIO = io => typeof io === 'function' ? io() : io;
    const mapDep = service => service in deps ? deps[service] : service;
    const camelKebap = camel => camel.replace(/([a-z])([A-Z0-9])|([0-9])([a-zA-Z])/g, (_, l, u, ll, uu) => `${l||ll}-${u||uu}`).toLowerCase();
    const configTrace = (service, method) => service === 'io' ? { service } : { service, method };

    // we need a real function to have a this argument
    function proxy(service, method, ...args) {
        return service === 'io' ? doIO(method) : serviceCall(mapDep(camelKebap(service)), method, args, this);
    }

    local(traceFn('proxy', configTrace, proxy));

    if (tracer) app.use(wakeMiddleware);
    app.use(rpcMiddleware);
    if (tracer) app.use(wakeError);

    return function start(port = 5000) {
        const server = app.listen(port);

        return { server, app };
    };
}

microbrew.debug = (name, module, deps, tracer) => microbrew(name, module, deps, tracer, true);

module.exports = microbrew;
