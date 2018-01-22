module.exports = (req, res) => {
    const out = {};

    const whitelist = {
        "NODE_ENV"            : String,
        "GOOGLE_ANALYTICS_ID" : String
    };

    Object.keys(whitelist).forEach(key => {
        if (process.env.hasOwnProperty(key)) {
            out[key] = whitelist[key](process.env[key]);
        }
    });

    res.type("javascript").send(`var ENV = ${JSON.stringify(out, null, 4)};`);
};
