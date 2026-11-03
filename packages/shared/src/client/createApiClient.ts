import { ApiCore, type ApiClientOptions } from "./core";
import { adminEndpoints } from "./endpoints/admin";
import {
  directoryEndpoints,
  eventEndpoints,
  businessEndpoints,
  chatEndpoints,
  fundingEndpoints,
  jobEndpoints,
  membershipEndpoints,
  mentorshipEndpoints,
  notificationEndpoints,
  paymentEndpoints,
  postEndpoints,
  celebrationEndpoints,
  reportEndpoints,
  uploadEndpoints,
} from "./endpoints/member";
import { platformEndpoints } from "./endpoints/platform";
import { authEndpoints, meEndpoints, tenantEndpoints, unsubscribeEndpoints } from "./endpoints/public";

export function createApiClient(options: ApiClientOptions) {
  const core = new ApiCore(options);
  return {
    core,
    tenants: tenantEndpoints(core),
    auth: authEndpoints(core),
    unsubscribe: unsubscribeEndpoints(core),
    me: meEndpoints(core),
    membership: membershipEndpoints(core),
    directory: directoryEndpoints(core),
    jobs: jobEndpoints(core),
    funding: fundingEndpoints(core),
    businesses: businessEndpoints(core),
    chat: chatEndpoints(core),
    mentorship: mentorshipEndpoints(core),
    posts: postEndpoints(core),
    celebrations: celebrationEndpoints(core),
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
