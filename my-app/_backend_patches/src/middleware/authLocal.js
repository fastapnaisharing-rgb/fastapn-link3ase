import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

export async function verifyAuthLocal(req, res, next) {
  const header = req.headers.authorization;
  let token;
  if (header && header.startsWith("Bearer ")) {
    token = header.slice(7);
  } else if (req.path === "/api/docenter/queue/stream" && req.query && req.query.token) {
    // SSE (EventSource) ใส่ Custom Header เองไม่ได้ -- รับ Token ผ่าน Query เฉพาะ Route นี้เท่านั้น
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    console.error("JWT verify failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
