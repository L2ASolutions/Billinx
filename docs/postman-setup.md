# Postman Setup Guide — Billinx API

## Importing the Collection

1. Open Postman.
2. Click **Import** (top-left, or Ctrl+O on Windows).
3. Choose **File** and select `docs/billinx-api.postman_collection.json` from this repository.
4. Click **Import**. The "Billinx Compliance API" collection will appear in your sidebar.

## Setting Up an Environment

The collection uses four variables. Create a Postman Environment to store them:

1. In Postman, click **Environments** (left panel) → **+** to create a new environment.
2. Name it `Billinx Local` (or `Billinx Staging`, etc.).
3. Add the following variables:

| Variable | Initial Value | Description |
|---|---|---|
| `base_url` | `http://localhost:3000` | API base URL |
| `api_key` | _(empty)_ | Your tenant API key (`blx_...`) |
| `jwt_token` | _(empty)_ | JWT access token from login |
| `admin_token` | _(empty)_ | Admin JWT from admin login |

4. Click **Save**.
5. Select the environment from the environment dropdown (top-right in Postman).

## Getting Your API Key

API keys are used for programmatic/machine-to-machine access.

1. Log in via the dashboard or call `POST /v1/users/login` to get a JWT.
2. Call `POST /v1/api-keys` with your JWT:

```bash
curl -X POST http://localhost:3000/v1/api-keys \
  -H "Authorization: Bearer <your_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App Key", "description": "Production integration"}'
```

3. Copy the `key` field from the response (begins with `blx_`). This is only shown once.
4. Paste it as the `api_key` environment variable in Postman.
5. Use `Bearer {{api_key}}` in your request Authorization headers.

## Getting a JWT Token

For dashboard/user operations, use a JWT:

1. Open **Users → Login** in the Postman collection.
2. Fill in `tenantId`, `email`, and `password`.
3. Send the request.
4. Copy the `accessToken` from the response.
5. Paste it as the `jwt_token` environment variable.

Alternatively, set up a test script on the Login request to auto-populate the variable:

```javascript
// In the Login request Tests tab:
const token = pm.response.json().accessToken;
pm.environment.set("jwt_token", token);
```

## Getting an Admin Token

For admin endpoints (L2A Solutions staff only):

1. Open **Admin → Admin Login**.
2. Use your L2A Solutions admin credentials.
3. Copy the `accessToken` and set it as `admin_token`.

## Common Troubleshooting

### 401 Unauthorized
- Check that the correct token variable (`{{api_key}}` vs `{{jwt_token}}` vs `{{admin_token}}`) is set and not empty.
- JWT tokens expire after 15 minutes. Call `/v1/auth/refresh` or log in again.
- API keys do not expire unless explicitly revoked.

### 403 Forbidden
- You are authenticated but your role lacks permission for the endpoint. Some endpoints require OWNER or ADMIN role.

### 409 Conflict
- You sent a request with an `Idempotency-Key` that was already used within the last 24 hours. Generate a new unique key.

### 422 / Validation Errors
- Check the `errors` array in the response for field-level validation failures.
- For invoice creation, ensure `taxTotal.taxAmount` matches the sum of `taxSubtotals`.

### 429 Too Many Requests
- You have exceeded your tier's rate limit. Wait and retry, or contact support to upgrade your tier.

### Connection Refused
- Ensure the Billinx API is running: `npm run start:dev` from the `billinx/` directory.
- Check that `base_url` in your environment matches the running server (default: `http://localhost:3000`).

## Testing the Full Invoice Flow

1. **Register** → creates a tenant and OWNER user.
2. **Login** → get a JWT, set `{{jwt_token}}`.
3. **Create API Key** → get an API key, set `{{api_key}}`.
4. **Validate Invoice** → test your invoice payload without submitting.
5. **Create Invoice** → submit to FIRS; note the returned `id`.
6. **Get Invoice Status** → poll until `status` is `ACCEPTED` or `REJECTED`.
7. **Create Webhook** → subscribe to `invoice.accepted` to receive push notifications.
