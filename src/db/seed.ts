import "dotenv/config";
import { ROLE_PERMISSIONS } from '../lib/shared/permissions';
import { Argon2id } from 'oslo/password';
import { Effect, Cause, Exit, Data } from 'effect';
import { db, closeDb } from './client';
import type { PlatformAdminId, UserId, DeckId, SrsCardId, GrammarPointId } from '../types';

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

    yield* Effect.logInfo('[Seed] Cleaning old srs_card and grammar_point records to prevent unique index conflicts...');
    yield* Effect.tryPromise({
      try: () => db.deleteFrom('srs_card').execute(),
      catch: (cause) => new SeedingError({ cause })
    });
    yield* Effect.tryPromise({
      try: () => db.deleteFrom('grammar_point').execute(),
      catch: (cause) => new SeedingError({ cause })
    });

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

    yield* Effect.logInfo('[Seed] Adding Japanese sample deck...');
    const sampleDeckId = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c33" as DeckId;
    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto('deck')
          .values({
            id: sampleDeckId,
            name: "Conversational Japanese",
            category: "Japanese",
            content: JSON.stringify({ description: "Essential survival phrases and foundational grammar." }),
            created_at: new Date(),
            updated_at: new Date(),
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute(),
      catch: (cause) => new SeedingError({ cause }),
    });

    yield* Effect.logInfo('[Seed] Writing abstract N5/N4 grammar points...');
    const grammarPoints = [
      {
        id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だ",
        base_meaning: "To be, Is",
        lesson_number: 1,
        sequence_order: 1,
        difficulty_level: "N5"
      },
      {
        id: "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "です",
        base_meaning: "To be, Is (Polite)",
        lesson_number: 1,
        sequence_order: 2,
        difficulty_level: "N5"
      },
      {
        id: "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "は",
        base_meaning: "Topic marker",
        lesson_number: 1,
        sequence_order: 3,
        difficulty_level: "N5"
      },
      {
        id: "11eebc99-9c0b-4ef8-bb6d-6bb9bd381b22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "も",
        base_meaning: "Also, too",
        lesson_number: 1,
        sequence_order: 4,
        difficulty_level: "N5"
      },
      {
        id: "22eebc99-9c0b-4ef8-bb6d-6bb9bd381c33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "に",
        base_meaning: "Destination, time, location",
        lesson_number: 1,
        sequence_order: 5,
        difficulty_level: "N5"
      },
      {
        id: "33eebc99-9c0b-4ef8-bb6d-6bb9bd381d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "で",
        base_meaning: "Location of action, by means of",
        lesson_number: 1,
        sequence_order: 6,
        difficulty_level: "N5"
      },
      {
        id: "44eebc99-9c0b-4ef8-bb6d-6bb9bd381e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "を",
        base_meaning: "Object marker",
        lesson_number: 1,
        sequence_order: 7,
        difficulty_level: "N5"
      },
      {
        id: "55eebc99-9c0b-4ef8-bb6d-6bb9bd381f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "が",
        base_meaning: "Subject marker",
        lesson_number: 1,
        sequence_order: 8,
        difficulty_level: "N5"
      },
      {
        id: "66eebc99-9c0b-4ef8-bb6d-6bb9bd382a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "から",
        base_meaning: "From, because",
        lesson_number: 1,
        sequence_order: 9,
        difficulty_level: "N5"
      },
      {
        id: "77eebc99-9c0b-4ef8-bb6d-6bb9bd382b22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "まで",
        base_meaning: "Until, to",
        lesson_number: 1,
        sequence_order: 10,
        difficulty_level: "N5"
      },
      {
        id: "88eebc99-9c0b-4ef8-bb6d-6bb9bd382c33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "と",
        base_meaning: "And, with",
        lesson_number: 1,
        sequence_order: 11,
        difficulty_level: "N5"
      },
      {
        id: "99eebc99-9c0b-4ef8-bb6d-6bb9bd382d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "よ",
        base_meaning: "Sentence ending emphasis",
        lesson_number: 1,
        sequence_order: 12,
        difficulty_level: "N5"
      },
      {
        id: "aaeebc99-9c0b-4ef8-bb6d-6bb9bd382e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ね",
        base_meaning: "Sentence ending agreement",
        lesson_number: 1,
        sequence_order: 13,
        difficulty_level: "N5"
      },
      {
        id: "bbeebc99-9c0b-4ef8-bb6d-6bb9bd382f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "～んです",
        base_meaning: "Explanatory / soft emphasis",
        lesson_number: 1,
        sequence_order: 14,
        difficulty_level: "N5"
      },
      {
        id: "cceebc99-9c0b-4ef8-bb6d-6bb9bd383a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "の",
        base_meaning: "Casual rising question marker",
        lesson_number: 1,
        sequence_order: 15,
        difficulty_level: "N5"
      },
      {
        id: "ddeebc99-9c0b-4ef8-bb6d-6bb9bd383b22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "けど",
        base_meaning: "Contrast, sentence softening",
        lesson_number: 1,
        sequence_order: 16,
        difficulty_level: "N5"
      },
      {
        id: "eeeebc99-9c0b-4ef8-bb6d-6bb9bd383c33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "って",
        base_meaning: "Casual quotation / topic marker",
        lesson_number: 1,
        sequence_order: 17,
        difficulty_level: "N5"
      },
      {
        id: "01eebc99-9c0b-4ef8-bb6d-6bb9bd383d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "とか",
        base_meaning: "Casual list listing",
        lesson_number: 1,
        sequence_order: 18,
        difficulty_level: "N5"
      },
      {
        id: "02eebc99-9c0b-4ef8-bb6d-6bb9bd383e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ちゃう",
        base_meaning: "Regret or completion contraction",
        lesson_number: 1,
        sequence_order: 19,
        difficulty_level: "N4"
      },
      {
        id: "03eebc99-9c0b-4ef8-bb6d-6bb9bd383f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "とく",
        base_meaning: "Action in advance contraction",
        lesson_number: 1,
        sequence_order: 20,
        difficulty_level: "N4"
      },
      {
        id: "04eebc99-9c0b-4ef8-bb6d-6bb9bd384a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なきゃ",
        base_meaning: "Casual obligation contraction",
        lesson_number: 1,
        sequence_order: 21,
        difficulty_level: "N4"
      },
      {
        id: "05eebc99-9c0b-4ef8-bb6d-6bb9bd384b22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "みたい",
        base_meaning: "Casual resemblance / conjecture",
        lesson_number: 1,
        sequence_order: 22,
        difficulty_level: "N4"
      }
    ];

    for (const point of grammarPoints) {
      yield* Effect.tryPromise({
        try: () =>
          db
            .insertInto('grammar_point')
            .values({
              ...point,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .onConflict((oc) => oc.column('id').doNothing())
            .execute(),
        catch: (cause) => new SeedingError({ cause }),
      });
    }

    yield* Effect.logInfo('[Seed] Appending introductory review metrics...');
    const srsCardsToSeed = grammarPoints.map((gp, index) => {
      const hexIndex = index.toString(16).padStart(2, '0');
      return {
        id: `d0eebc99-9c0b-4ef8-bb6d-6bb9bd380d${hexIndex}` as SrsCardId,
        user_id: SAMPLE_LEARNER_ID,
        grammar_point_id: gp.id,
        ease_factor: 2.5,
        repetitions: 0,
        interval_days: 0,
        next_review: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };
    });

    for (const card of srsCardsToSeed) {
      yield* Effect.tryPromise({
        try: () =>
          db
            .insertInto('srs_card')
            .values(card)
            .onConflict((oc) => oc.column('id').doNothing())
            .execute(),
        catch: (cause) => new SeedingError({ cause }),
      });
    }

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
