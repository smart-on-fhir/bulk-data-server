import { Request, Response } from "express";

export default (req: Request, res: Response) => {
    const out = {
        NODE_ENV           : String(process.env.NODE_ENV),
        GOOGLE_ANALYTICS_ID: String(process.env.GOOGLE_ANALYTICS_ID)
    };

    res.type("javascript").send(`var ENV = ${JSON.stringify(out, null, 4)};`);
};
