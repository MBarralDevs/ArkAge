# x402 Seller Onboarding

ArkAge supports two hosting modes for x402-priced endpoints. Pick one when you call `arkage:register_x402_endpoint`.

## Mode A: `arkage-proxy` (zero-infra)

Best for: agents without their own server, hackathon teams, evaluation use.

1. Call `arkage:register_x402_endpoint` with `hosting: "arkage-proxy"` and `url` pointing at your unprotected upstream URL.
2. ArkAge returns `effectiveUrl = https://arkage.network/api/x402-proxy/<endpointId>`.
3. Publish that URL to buyers (in your agent metadata, x402 endpoint registry, etc.).
4. Buyers call the proxy URL → ArkAge wraps Circle's gateway middleware → forwards verified requests to your upstream. You receive the original request body / query string with all `payment-*` headers stripped.
5. Receipts persist automatically; you can read them with `arkage:list_my_x402_receipts` (role=seller).

Trade-offs: ArkAge sees every request before forwarding. If your endpoint serves sensitive data, prefer Mode B.

## Mode B: `self` (you own the middleware)

Best for: production sellers, sensitive endpoints, custom error handling.

1. Install Circle's middleware in your server:

   ```bash
   npm install @circle-fin/x402-batching @x402/core @x402/evm viem express
   ```

2. Wrap your route with `createGatewayMiddleware`:

   ```ts
   import express from "express";
   import { createGatewayMiddleware } from "@circle-fin/x402-batching";

   const app = express();
   const gateway = createGatewayMiddleware({
     chain: "arcTestnet",
     payTo: "0xYourTier2EOA…",
   });

   app.get("/api/data", gateway.require("$0.01"), (req, res) => {
     res.json({ data: "your protected payload" });
   });
   ```

3. Deploy somewhere reachable (Vercel, Fly, Railway, your laptop with ngrok).
4. Call `arkage:register_x402_endpoint` with `hosting: "self"` and `url` pointing at your deployed endpoint.
5. ArkAge subscribes to Circle's facilitator webhook for receipts on the seller wallet you registered.

## Verifying receipts

After the first paid call lands:

```
arkage:list_my_x402_receipts asAgent=<id> role=seller limit=5
```

Should return the receipt with the buyer wallet, amount, and processed timestamp.

## Pricing changes

x402 endpoint price is set at registration. Update it via SQL for now:

```sql
UPDATE x402_endpoints SET price_per_call = '5000' WHERE id = <endpointId>;
```

A dedicated `arkage:update_x402_endpoint_price` MCP tool is logged for v1.5.
