import { ApiCore, type ApiClientOptions } from "./core";
import { adminEndpoints } from "./endpoints/admin";
import {
  directoryEndpoints,
  eventEndpoints,
  fundingEndpoints,
  jobEndpoints,
  membershipEndpoints,
  notificationEndpoints,
  paymentEndpoints,
  postEndpoints,
  reportEndpoints,
  uploadEndpoints,
} from "./endpoints/member";
import { platformEndpoints } from "./endpoints/platform";
import { authEndpoints, meEndpoints, tenantEndpoints } from "./endpoints/public";

export function createApiClient(options: ApiClientOptions) {
  const core = new ApiCore(options);
  return {
    core,
    tenants: tenantEndpoints(core),
    auth: authEndpoints(core),
    me: meEndpoints(core),
    membership: membershipEndpoints(core),
    directory: directoryEndpoints(core),
    jobs: jobEndpoints(core),
    funding: fundingEndpoints(core),
    posts: postEndpoints(core),
    events: eventEndpoints(core),
    reports: reportEndpoints(core),
    notifications: notificationEndpoints(core),
    uploads: uploadEndpoints(core),
    payments: paymentEndpoints(core),
    admin: adminEndpoints(core),
    platform: platformEndpoints(core),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
