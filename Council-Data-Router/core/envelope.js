const { v4: uuidv4 } = require('uuid');

module.exports = function wrap(payload, status = 'STABLE') {
    return {
        header: {
            node_id: "WSL-ALVIN-NODE-01",
            packet_id: uuidv4(),
            timestamp: new Date().toISOString(),
            schema_version: "2.0.0",
            status: status,
            priority: "REALTIME"
        },
        payload: payload
    };
};
