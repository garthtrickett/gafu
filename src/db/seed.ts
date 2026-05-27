import "dotenv/config";
import { ROLE_PERMISSIONS } from '../lib/shared/permissions';
import { Argon2id } from 'oslo/password';
import { Effect, Cause, Exit, Data } from 'effect';
import { db, closeDb } from './client';
import type { PlatformAdminId, UserId, DeckId, SrsCardId } from '../types';

class SeedingError extends Data.TaggedError("SeedingError")<{
  readonly cause: unknown;
}> {}

class PasswordHashingError extends Data.TaggedError("PasswordHashingError")<{
  readonly cause: unknown;
}> {}

const PASSWORD = 'Password123!';
const SUPER_ADMIN_ID = "99999999-9999-9999-9999-999999999999" as PlatformAdminId;
const SAMPLE_LEARNER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId;
const SAMPLE_CURATOR_ID = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22" as UserId;

const seedDb = () =>
  Effect.gen(function* () {
    yield* Effect.logInfo('[Seed] Commencing global database seeding...');

    const argon2id = new Argon2id();
    const hashedPassword = yield* Effect.tryPromise({
      try: () => argon2id.hash(PASSWORD),
      catch: (cause) => new PasswordHashingError({ cause }),
    });

    yield* Effect.logInfo('[Seed] Writing Super Admin user...');
    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto('platform_admin')
          .values({
            id: SUPER_ADMIN_ID,
            email: 'super-admin@bedrock.com',
            password_hash: hashedPassword,
            created_at: new Date(),
          })
          .onConflict((oc) => oc.column('email').doUpdateSet({
            password_hash: hashedPassword,
          }))
          .execute(),
      catch: (cause) => new SeedingError({ cause }),
    });

    yield* Effect.logInfo('[Seed] Writing Learner and Curator users...');
    const subscriberPerms = [...ROLE_PERMISSIONS.SUBSCRIBER];
    const curatorPerms = [...ROLE_PERMISSIONS.CURATOR];

    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto('user')
          .values([
            {
              id: SAMPLE_LEARNER_ID,
              email: 'learner@site.com',
              password_hash: hashedPassword,
              permissions: subscriberPerms,
              email_verified: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
            {
              id: SAMPLE_CURATOR_ID,
              email: 'curator@site.com',
              password_hash: hashedPassword,
              permissions: curatorPerms,
              email_verified: true,
              created_at: new Date(),
              updated_at: new Date(),
            }
          ])
          .onConflict((oc) => oc.column('email').doNothing())
          .execute(),
      catch: (cause) => new SeedingError({ cause }),
    });

    yield* Effect.logInfo('[Seed] Adding Japanese N5 sample deck...');
    const sampleDeckId = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c33" as DeckId;
    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto('deck')
          .values({
            id: sampleDeckId,
            name: "Conversational Japanese N5",
            category: "Japanese",
            content: JSON.stringify({ description: "Essential survival phrases and foundational grammar." }),
            created_at: new Date(),
            updated_at: new Date(),
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute(),
      catch: (cause) => new SeedingError({ cause }),
    });

    yield* Effect.logInfo('[Seed] Appending introductory review cards...');
    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto('srs_card')
          .values({
            id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380d44" as SrsCardId,
            user_id: SAMPLE_LEARNER_ID,
            deck_id: sampleDeckId,
            front: "Excuse me, where is the station?",
            back: "すみません、駅はどこですか？",
            audio_url: "https://pub-r2.dev/media/ja-station.mp3",
            ease_factor: 2.5,
            repetitions: 0,
            interval_days: 0,
            next_review: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute(),
      catch: (cause) => new SeedingError({ cause }),
    });

    yield* Effect.logInfo('[Seed] All seeding tasks finished.');
  });

const seedProgram = Effect.gen(function* () {
  yield* seedDb();
});

void Effect.runPromiseExit(seedProgram).then((exit) => {
  void closeDb().then(() => {
    if (Exit.isSuccess(exit)) {
      console.info("🌱 Database initialized with default records.");
      process.exit(0);
    } else {
      console.error('\n❌ Seeding script failed:\n');
      console.error(Cause.pretty(exit.cause));
      process.exit(1);
    }
  });
});
