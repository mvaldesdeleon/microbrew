const express = require('express');
const wake = require('express-wake');
const rpc = require('express-rpc-beeson');
const local = require('local-rpc');
const got = require('got');

function microbrew(module, deps = {}, tracer, debug) {
    const app = express();

    const { middleware: rpcMiddleware, consumeWith } = rpc(module, {debug});
    const serviceCall = (host, method, args, requestData) => {
        // TODO here is where we can control the retry-on-error logic, after the consumer API is defined
        // TODO we need to configure the requester so that it will propagate the request data via headers
        const run = consumeWith(got);

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

microbrew.debug = (module, deps, tracer) => microbrew(module, deps, tracer, true);

module.exports = microbrew;
