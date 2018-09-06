const router = require("express").Router({ mergeParams: true });
const ursa   = require('ursa');
const crypto = require("crypto");
const jwk    = require("jwk-lite");

module.exports = router;

router.get("/rsa", (req, res) => {

    let enc = req.query.enc;
    if (["base64", "binary", "hex", "utf8"].indexOf(enc) == -1) {
        enc = undefined;
    }

    // create a pair of keys (a private key contains both keys...)
    const keys = ursa.generatePrivateKey();

    // reconstitute the private and public keys from a base64 encoding
    const privatePem = keys.toPrivatePem(enc);
    const publicPem  = keys.toPublicPem(enc);

    // make a private key, to be used for encryption
    const privateKey = ursa.createPrivateKey(privatePem, '', enc);

    // make a public key, to be used for decryption
    const publicKey = ursa.createPublicKey(publicPem, enc);

    res.json({
        privateKey: privatePem,
        publicKey : publicPem
    });

});

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

router.get("/random", (req, res) => {
    
    let enc = req.query.enc;
    if (["base64", "binary", "hex", "utf8"].indexOf(enc) == -1) {
        enc = undefined;
    }

    let len = +req.query.len;
    if (isNaN(len) || !isFinite(len) || len < 1 || len > 1024) {
        len = 32;
    }
    
    res.send(crypto.randomBytes(len).toString(enc));
});
