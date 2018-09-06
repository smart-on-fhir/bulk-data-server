const router = require("express").Router({ mergeParams: true });
const crypto = require("crypto");
const jwk    = require("jwk-lite");

module.exports = router;

router.get("/jwks", (req, res) => {
    let alg = String(req.query.alg || "").toUpperCase();
    if (["RS384", "ES384"].indexOf(alg) == -1) {
        alg = "RS384";
    }

    jwk.generateKey(alg).then(result => {
        Promise.all([
            jwk.exportKey(result.publicKey),
            jwk.exportKey(result.privateKey)
        ]).then(keys => {
            let out = { keys: [...keys] };
            let kid = crypto.randomBytes(16).toString("hex");
            out.keys.forEach(key => {
                key.kid = kid;
                if (!key.alg) {
                    key.alg = alg;
                }
            });
            res.json(out);
        });
    });
});
