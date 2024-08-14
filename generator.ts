import express from "express"
import crypto  from "crypto"
import jwk     from "jwk-lite"

const router = express.Router({ mergeParams: true });


router.get("/jwks", (req, res) => {
    let alg = String(req.query.alg || "").toUpperCase();
    if (["RS384", "ES384"].indexOf(alg) == -1) {
        alg = "RS384";
    }
    
    jwk.generateKey(alg).then((result: any) => {
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

export default router