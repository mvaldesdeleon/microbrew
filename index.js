const express = require('express');
const wake = require('express-wake');
const rpc = require('express-rpc-beeson');
const local = require('local-rpc');
const got = require('got');

function microbrew(module, deps = {}, tracer, debug) {
    const app = express();

    const { middleware: rpcMiddleware, consumeWith } = rpc(module, {debug});
    const run = consumeWith(got);

    const { middleware: wakeMiddleware, error: wakeError, decorator: traceFn } = wake(tracer);

    const doIO = io => typeof io === 'function' ? io() : io;
    const mapDep = service => service in deps ? deps[service] : service;
    const proxy = (service, method, ...args) => service === 'io' ? doIO(method) : run(mapDep(service), method, args);
    const configTrace = (service, method) => service === 'io' ? { service } : { service, method };

    local(traceFn('proxy', configTrace, proxy));

    if (tracer) app.use(wakeMiddleware);
    app.use(rpcMiddleware);
    if (tracer) app.use(wakeError);

    return function start(port = 5000) {
        const server = app.listen(port);

        return { server, app };
    };
}

microbrew.debug = (module, deps, tracer) => microbrew(module, deps, tracer, true);

module.exports = microbrew;
