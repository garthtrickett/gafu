import { describe, it, expect, beforeEach } from "vitest";
import { createLocalStore } from "./LocalStoreFactory";
import { userState } from "../stores/authStore";
import { runClientPromise } from "../runtime";

interface DummyData {
  readonly id: string;
  readonly value: string;
}

describe("LocalStoreFactory User Namespacing & Isolation", () => {
  const testStore = createLocalStore<DummyData>("dummy_isolation_test");

  beforeEach(async () => {
    userState.value = null;
    await runClientPromise(testStore.clear());
  });

  it("should strictly segregate storage keys and data entries between authenticated users", async () => {
    // 1. Authenticate as User A
    userState.value = {
      id: "user-A-uuid",
      email: "userA@site.com",
      permissions: []
    };
    await runClientPromise(testStore.load());
    await runClientPromise(testStore.put({ id: "item-1", value: "User A Private Data" }));

    expect(testStore.state.peek()).toHaveLength(1);
    expect(testStore.state.peek()[0]?.value).toBe("User A Private Data");

    // 2. Switch context to User B
    userState.value = {
      id: "user-B-uuid",
      email: "userB@site.com",
      permissions: []
    };
    
    // Reload the store with User B's context
    await runClientPromise(testStore.load());

    // User B's view of the store should be isolated and empty
    expect(testStore.state.peek()).toHaveLength(0);

    // Add User B private data
    await runClientPromise(testStore.put({ id: "item-1", value: "User B Private Data" }));
    expect(testStore.state.peek()).toHaveLength(1);
    expect(testStore.state.peek()[0]?.value).toBe("User B Private Data");

    // 3. Switch back to User A to ensure no data contamination occurred
    userState.value = {
      id: "user-A-uuid",
      email: "userA@site.com",
      permissions: []
    };
    await runClientPromise(testStore.load());

    expect(testStore.state.peek()).toHaveLength(1);
    expect(testStore.state.peek()[0]?.value).toBe("User A Private Data");
  });
});
