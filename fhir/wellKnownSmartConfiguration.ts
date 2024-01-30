import { Request, Response } from "express"
import config                from "../config"
import { getAvailableResourceTypes, uInt } from "../lib";


export default async (req: Request, res: Response) => {

    try {
        // @ts-ignore
        const fhirVersion = uInt(req.sim.stu, 4)
        
        const availableResourceTypes = await getAvailableResourceTypes(fhirVersion);
        
        const json = {

            token_endpoint: `${config.baseUrl}/auth/token`,

            registration_endpoint: `${config.baseUrl}/auth/register`,

            // Array of client authentication methods supported by the token endpoint
            token_endpoint_auth_methods_supported: [
                "private_key_jwt"
            ],

            token_endpoint_auth_signing_alg_values_supported: config.supportedSigningAlgorithms,

            // Array of scopes a client may request
            scopes_supported: [
                "system/*.rs",
                ...availableResourceTypes.map(r => `system/${r}.rs`),
                "system/*.read",
                ...availableResourceTypes.map(r => `system/${r}.read`),
            ],

            // REQUIRED, array of strings representing SMART capabilities
            capabilities: [
                "permission-v2",
                "permission-v1",
                "client-confidential-asymmetric"
            ]
        };

        res.json(json);
    }
    catch (ex) {
        res.status(500).json({ error: ex + "" })
    }
};
