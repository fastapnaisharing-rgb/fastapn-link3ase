import { jwtVerify, createSecretKey } from "jose";
import dotenv from "dotenv";

dotenv.config();

const secret = createSecretKey(Buffer.from(process.env.JWT_SECRET, "utf-8"));

export async function verifyAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice(7);

  try {
    const { payload } = await jwtVerify(token, secret);

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (err) {
    console.error("JWT verify failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}