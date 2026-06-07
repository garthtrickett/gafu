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

export const seedDb = (options?: { clearData?: boolean })
  => Effect.gen(function* () {
    const clearData = options?.clearData ?? true;
    yield* Effect.logInfo(`[Seed] Commencing global database seeding (clearData=${clearData})...`);

    if (clearData) {
      yield* Effect.logInfo('[Seed] Cleaning old srs_card and grammar_point records to prevent unique index conflicts...');
      yield* Effect.tryPromise({
        try: () => db.deleteFrom('srs_card').execute(),
        catch: (cause) => new SeedingError({ cause })
      });
      yield* Effect.tryPromise({
        try: () => db.deleteFrom('grammar_point').execute(),
        catch: (cause) => new SeedingError({ cause })
      });
    }

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
        id: "01eebc99-9c0b-4ef8-bb6d-6bb9bd383d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "とか",
        base_meaning: "Casual list listing",
        lesson_number: 1,
        sequence_order: 18,
        difficulty_level: "N5"
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
      },
      {
        id: "06eebc99-9c0b-4ef8-bb6d-6bb9bd384c33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "これ",
        base_meaning: "This (demonstrative pronoun)",
        lesson_number: 1,
        sequence_order: 23,
        difficulty_level: "N5"
      },
      {
        id: "07eebc99-9c0b-4ef8-bb6d-6bb9bd384d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "それ",
        base_meaning: "That (demonstrative pronoun)",
        lesson_number: 1,
        sequence_order: 24,
        difficulty_level: "N5"
      },
      {
        id: "08eebc99-9c0b-4ef8-bb6d-6bb9bd384e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "あれ",
        base_meaning: "That over there (demonstrative pronoun)",
        lesson_number: 1,
        sequence_order: 25,
        difficulty_level: "N5"
      },
      {
        id: "09eebc99-9c0b-4ef8-bb6d-6bb9bd384f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "か",
        base_meaning: "Question marking particle",
        lesson_number: 1,
        sequence_order: 26,
        difficulty_level: "N5"
      },
      {
        id: "10eebc99-9c0b-4ef8-bb6d-6bb9bd385a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ここ",
        base_meaning: "Here (spatial locative)",
        lesson_number: 1,
        sequence_order: 27,
        difficulty_level: "N5"
      },
      {
        id: "20eebc99-9c0b-4ef8-bb6d-6bb9bd385b22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "そこ",
        base_meaning: "There (spatial locative)",
        lesson_number: 1,
        sequence_order: 28,
        difficulty_level: "N5"
      },
      {
        id: "30eebc99-9c0b-4ef8-bb6d-6bb9bd385c33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "あそこ",
        base_meaning: "Over there (spatial locative)",
        lesson_number: 1,
        sequence_order: 29,
        difficulty_level: "N5"
      },
      {
        id: "40eebc99-9c0b-4ef8-bb6d-6bb9bd385d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜くない",
        base_meaning: "い-Adjective negative sound shift",
        lesson_number: 1,
        sequence_order: 30,
        difficulty_level: "N5"
      },
      {
        id: "50eebc99-9c0b-4ef8-bb6d-6bb9bd385e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜じゃない",
        base_meaning: "な-Adjective negative sound shift",
        lesson_number: 1,
        sequence_order: 31,
        difficulty_level: "N5"
      },
      {
        id: "60eebc99-9c0b-4ef8-bb6d-6bb9bd385f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ない (る-Verb Negative)",
        base_meaning: "Casual negative form of Ichidan verbs",
        lesson_number: 1,
        sequence_order: 32,
        difficulty_level: "N5"
      },
      {
        id: "70eebc99-9c0b-4ef8-bb6d-6bb9bd386a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ない (う-Verb Negative)",
        base_meaning: "Casual negative form of Godan verbs",
        lesson_number: 1,
        sequence_order: 33,
        difficulty_level: "N5"
      },
      {
        id: "80eebc99-9c0b-4ef8-bb6d-6bb9bd386b22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ます",
        base_meaning: "Polite action verb ending",
        lesson_number: 1,
        sequence_order: 34,
        difficulty_level: "N5"
      },
      {
        id: "90eebc99-9c0b-4ef8-bb6d-6bb9bd386c33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "でしょう",
        base_meaning: "Conjecture/polite request for agreement",
        lesson_number: 1,
        sequence_order: 35,
        difficulty_level: "N5"
      },
      {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd386d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だろう",
        base_meaning: "Casual conjecture / agreement trigger",
        lesson_number: 1,
        sequence_order: 36,
        difficulty_level: "N5"
      },
      {
        id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd386e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "がある",
        base_meaning: "Inanimate existence (there is / to have)",
        lesson_number: 1,
        sequence_order: 37,
        difficulty_level: "N5"
      },
      {
        id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd386f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "がいる",
        base_meaning: "Animate existence (there is / to have)",
        lesson_number: 1,
        sequence_order: 38,
        difficulty_level: "N5"
      },
      {
        id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd387a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "この",
        base_meaning: "This (demonstrative modifier)",
        lesson_number: 1,
        sequence_order: 39,
        difficulty_level: "N5"
      },
      {
        id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd387b22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "その",
        base_meaning: "That (demonstrative modifier)",
        lesson_number: 1,
        sequence_order: 40,
        difficulty_level: "N5"
      },
      {
        id: "f0eebc99-9c0b-4ef8-bb6d-6bb9bd387c33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "あの",
        base_meaning: "That over there (demonstrative modifier)",
        lesson_number: 1,
        sequence_order: 41,
        difficulty_level: "N5"
      },
      {
        id: "00eebc99-9c0b-4ef8-bb6d-6bb9bd387d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜かった",
        base_meaning: "い-Adjective past tense sound shift",
        lesson_number: 1,
        sequence_order: 42,
        difficulty_level: "N5"
      },
      {
        id: "10eebc99-9c0b-4ef8-bb6d-6bb9bd387e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "の ( nominalizer )",
        base_meaning: "Verb nominalization (のは / のが)",
        lesson_number: 1,
        sequence_order: 43,
        difficulty_level: "N5"
      },
      {
        id: "20eebc99-9c0b-4ef8-bb6d-6bb9bd387f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "する",
        base_meaning: "To do (irregular verb anchor)",
        lesson_number: 1,
        sequence_order: 44,
        difficulty_level: "N5"
      },
      {
        id: "30eebc99-9c0b-4ef8-bb6d-6bb9bd388a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "くる",
        base_meaning: "To come (irregular verb anchor)",
        lesson_number: 1,
        sequence_order: 45,
        difficulty_level: "N5"
      },
      {
        id: "40eebc99-9c0b-4ef8-bb6d-6bb9bd388b22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜た (る)",
        base_meaning: "Ichidan casual past tense ending",
        lesson_number: 1,
        sequence_order: 46,
        difficulty_level: "N5"
      },
      {
        id: "50eebc99-9c0b-4ef8-bb6d-6bb9bd388c33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜た (う)",
        base_meaning: "Godan casual past tense ending (った/んだ/いだ)",
        lesson_number: 1,
        sequence_order: 47,
        difficulty_level: "N5"
      },
      {
        id: "60eebc99-9c0b-4ef8-bb6d-6bb9bd388d44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "好き",
        base_meaning: "To like / fond of (descriptive preference)",
        lesson_number: 1,
        sequence_order: 48,
        difficulty_level: "N5"
      },
      {
        id: "70eebc99-9c0b-4ef8-bb6d-6bb9bd388e55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "きらい",
        base_meaning: "Dislike / not fond of",
        lesson_number: 1,
        sequence_order: 49,
        difficulty_level: "N5"
      },
      {
        id: "80eebc99-9c0b-4ef8-bb6d-6bb9bd388f66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "のがすき",
        base_meaning: "To like doing (nominalized action preference)",
        lesson_number: 1,
        sequence_order: 50,
        difficulty_level: "N5"
      },
      {
        id: "02eebc99-9c0b-4ef8-bb6d-6bb9bd389a02" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ので / から",
        base_meaning: "Because, Since / Explanatory cause (ends in から/んで)",
        lesson_number: 5,
        sequence_order: 52,
        difficulty_level: "N5"
      },
      {
        id: "03eebc99-9c0b-4ef8-bb6d-6bb9bd389a03" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜なかった",
        base_meaning: "Past negative verb sound shift (casual past negation)",
        lesson_number: 5,
        sequence_order: 53,
        difficulty_level: "N5"
      },
      {
        id: "04eebc99-9c0b-4ef8-bb6d-6bb9bd389a04" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜て",
        base_meaning: "Te-form action conjunction / casual spoken request",
        lesson_number: 5,
        sequence_order: 54,
        difficulty_level: "N5"
      },
      {
        id: "05eebc99-9c0b-4ef8-bb6d-6bb9bd389a05" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ている (進行)",
        base_meaning: "Progressive aspect (usually contracted to 〜てる in fast speech)",
        lesson_number: 5,
        sequence_order: 55,
        difficulty_level: "N5"
      },
      {
        id: "06eebc99-9c0b-4ef8-bb6d-6bb9bd389a06" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜にいく",
        base_meaning: "To go do something (spoken intent anchor)",
        lesson_number: 5,
        sequence_order: 56,
        difficulty_level: "N5"
      },
      {
        id: "07eebc99-9c0b-4ef8-bb6d-6bb9bd389a07" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だれ",
        base_meaning: "Who (interrogative coordinate)",
        lesson_number: 6,
        sequence_order: 57,
        difficulty_level: "N5"
      },
      {
        id: "08eebc99-9c0b-4ef8-bb6d-6bb9bd389a08" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なんで / どうして",
        base_meaning: "Why / How come (dominates spoken casual queries)",
        lesson_number: 6,
        sequence_order: 58,
        difficulty_level: "N5"
      },
      {
        id: "09eebc99-9c0b-4ef8-bb6d-6bb9bd389a09" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "じゃない",
        base_meaning: "Is not / Isn't (casual present copula negation)",
        lesson_number: 6,
        sequence_order: 59,
        difficulty_level: "N5"
      },
      {
        id: "10eebc99-9c0b-4ef8-bb6d-6bb9bd389a10" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜くなかった",
        base_meaning: "い-Adjective past negation sound shift",
        lesson_number: 6,
        sequence_order: 60,
        difficulty_level: "N5"
      },
      {
        id: "11eebc99-9c0b-4ef8-bb6d-6bb9bd389a11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "って",
        base_meaning: "Casual quotation / topic marker / hearsay anchor",
        lesson_number: 6,
        sequence_order: 61,
        difficulty_level: "N5"
      },
      {
        id: "12eebc99-9c0b-4ef8-bb6d-6bb9bd389a12" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Verb + Noun",
        base_meaning: "Relative modified noun clauses (verb precedes modified noun)",
        lesson_number: 6,
        sequence_order: 62,
        difficulty_level: "N5"
      },
      {
        id: "13eebc99-9c0b-4ef8-bb6d-6bb9bd389a13" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "の (省略)",
        base_meaning: "Noun replacement / possession omission (mine, the blue one)",
        lesson_number: 6,
        sequence_order: 63,
        difficulty_level: "N5"
      },
      {
        id: "14eebc99-9c0b-4ef8-bb6d-6bb9bd389a14" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "な",
        base_meaning: "Colloquial prohibitive negative command (Don't!)",
        lesson_number: 6,
        sequence_order: 64,
        difficulty_level: "N5"
      },
      {
        id: "15eebc99-9c0b-4ef8-bb6d-6bb9bd389a15" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だけ",
        base_meaning: "Only, Just (spoken boundary/limit indicator)",
        lesson_number: 7,
        sequence_order: 65,
        difficulty_level: "N5"
      },
      {
        id: "16eebc99-9c0b-4ef8-bb6d-6bb9bd389a16" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "どこ",
        base_meaning: "Where (locative interrogative coordinate)",
        lesson_number: 7,
        sequence_order: 66,
        difficulty_level: "N5"
      },
      {
        id: "17eebc99-9c0b-4ef8-bb6d-6bb9bd389a17" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "どれ",
        base_meaning: "Which (choice/selection interrogative coordinate)",
        lesson_number: 7,
        sequence_order: 67,
        difficulty_level: "N5"
      },
      {
        id: "18eebc99-9c0b-4ef8-bb6d-6bb9bd389a18" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ている (状態)",
        base_meaning: "Resultative state of being (continuous physical/mental state)",
        lesson_number: 7,
        sequence_order: 68,
        difficulty_level: "N5"
      },
      {
        id: "19eebc99-9c0b-4ef8-bb6d-6bb9bd389a19" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "てから",
        base_meaning: "Once something happens / after doing",
        lesson_number: 7,
        sequence_order: 69,
        difficulty_level: "N5"
      },
      {
        id: "20eebc99-9c0b-4ef8-bb6d-6bb9bd389a20" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "もう / まだ",
        base_meaning: "Already / Still (time perspective anchors)",
        lesson_number: 7,
        sequence_order: 70,
        difficulty_level: "N5"
      },
      {
        id: "21eebc99-9c0b-4ef8-bb6d-6bb9bd389a21" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "まだ〜てない",
        base_meaning: "Still haven't done (something) / action incomplete",
        lesson_number: 7,
        sequence_order: 71,
        difficulty_level: "N5"
      },
      {
        id: "22eebc99-9c0b-4ef8-bb6d-6bb9bd389a22" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜てもいい",
        base_meaning: "Okay even if / seeking & granting casual permission",
        lesson_number: 7,
        sequence_order: 72,
        difficulty_level: "N5"
      },
      {
        id: "23eebc99-9c0b-4ef8-bb6d-6bb9bd389a23" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜たい",
        base_meaning: "To want to do (desire/intention spoken anchor)",
        lesson_number: 7,
        sequence_order: 73,
        difficulty_level: "N5"
      },
      {
        id: "24eebc99-9c0b-4ef8-bb6d-6bb9bd389a24" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜たり〜たりする",
        base_meaning: "Listing non-exhaustive / representative actions",
        lesson_number: 7,
        sequence_order: 74,
        difficulty_level: "N5"
      },
      {
        id: "25eebc99-9c0b-4ef8-bb6d-6bb9bd389a25" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "けっこう",
        base_meaning: "Quite / Polite spoken refusal (no thank you)",
        lesson_number: 8,
        sequence_order: 75,
        difficulty_level: "N5"
      },
      {
        id: "26eebc99-9c0b-4ef8-bb6d-6bb9bd389a26" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "たくさん",
        base_meaning: "A lot / Many (spoken quantifier)",
        lesson_number: 8,
        sequence_order: 76,
        difficulty_level: "N5"
      },
      {
        id: "27eebc99-9c0b-4ef8-bb6d-6bb9bd389a27" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "くらい / ぐらい",
        base_meaning: "About / Approximately (spoken quantity anchor)",
        lesson_number: 8,
        sequence_order: 77,
        difficulty_level: "N5"
      },
      {
        id: "28eebc99-9c0b-4ef8-bb6d-6bb9bd389a28" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "すぎる",
        base_meaning: "Too much / Excess evaluative ending",
        lesson_number: 8,
        sequence_order: 78,
        difficulty_level: "N5"
      },
      {
        id: "29eebc99-9c0b-4ef8-bb6d-6bb9bd389a29" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "にする",
        base_meaning: "To decide on / Restaurant ordering choice",
        lesson_number: 8,
        sequence_order: 79,
        difficulty_level: "N5"
      },
      {
        id: "30eebc99-9c0b-4ef8-bb6d-6bb9bd389a30" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜になる・〜くなる",
        base_meaning: "To become (change of state spoken indicator)",
        lesson_number: 8,
        sequence_order: 80,
        difficulty_level: "N5"
      },
      {
        id: "31eebc99-9c0b-4ef8-bb6d-6bb9bd389a31" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜のほうが",
        base_meaning: "Preferred comparison option anchor",
        lesson_number: 8,
        sequence_order: 81,
        difficulty_level: "N5"
      },
      {
        id: "32eebc99-9c0b-4ef8-bb6d-6bb9bd389a32" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なにか・なにも",
        base_meaning: "Something / Nothing (logical boundary pronoun)",
        lesson_number: 8,
        sequence_order: 82,
        difficulty_level: "N5"
      },
      {
        id: "33eebc99-9c0b-4ef8-bb6d-6bb9bd389a33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "誰か・どこか・誰も・どこも",
        base_meaning: "Indefinite person and locative coordinates",
        lesson_number: 8,
        sequence_order: 83,
        difficulty_level: "N5"
      },
      {
        id: "34eebc99-9c0b-4ef8-bb6d-6bb9bd389a34" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ましょう / 〜ましょうか",
        base_meaning: "Let's / Shall we (polite volitional offer/invitation)",
        lesson_number: 9,
        sequence_order: 84,
        difficulty_level: "N5"
      },
      {
        id: "35eebc99-9c0b-4ef8-bb6d-6bb9bd389a35" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ませんか",
        base_meaning: "Polite spoken invitation (Won't you do...?)",
        lesson_number: 9,
        sequence_order: 85,
        difficulty_level: "N5"
      },
      {
        id: "37eebc99-9c0b-4ef8-bb6d-6bb9bd389a37" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ないでください",
        base_meaning: "Polite negative request directive (Please don't...)",
        lesson_number: 9,
        sequence_order: 87,
        difficulty_level: "N5"
      },
      {
        id: "40eebc99-9c0b-4ef8-bb6d-6bb9bd389a40" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜たほうがいい / 〜ないほうがいい",
        base_meaning: "Advice anchor (Better to / Better not to)",
        lesson_number: 9,
        sequence_order: 90,
        difficulty_level: "N5"
      },
      {
        id: "42eebc99-9c0b-4ef8-bb6d-6bb9bd389a42" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜たことがある",
        base_meaning: "Past experience spoken indicator",
        lesson_number: 10,
        sequence_order: 92,
        difficulty_level: "N5"
      },
      {
        id: "43eebc99-9c0b-4ef8-bb6d-6bb9bd389a43" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Adjective + て / Noun + で",
        base_meaning: "Connective forms linking state descriptors",
        lesson_number: 10,
        sequence_order: 93,
        difficulty_level: "N5"
      },
      {
        id: "44eebc99-9c0b-4ef8-bb6d-6bb9bd389a44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "のがへた / のがじょうず",
        base_meaning: "Competence and skill level evaluators",
        lesson_number: 10,
        sequence_order: 94,
        difficulty_level: "N5"
      },
      {
        id: "45eebc99-9c0b-4ef8-bb6d-6bb9bd389a45" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "あげる / くれる / もらう",
        base_meaning: "Favor transaction auxiliary verbs (giving & receiving)",
        lesson_number: 10,
        sequence_order: 95,
        difficulty_level: "N5"
      },
      {
        id: "46eebc99-9c0b-4ef8-bb6d-6bb9bd389a46" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "つもりだ",
        base_meaning: "Intention / Future plan spoken indicator",
        lesson_number: 10,
        sequence_order: 96,
        difficulty_level: "N5"
      },
      {
        id: "47eebc99-9c0b-4ef8-bb6d-6bb9bd389a47" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "とき",
        base_meaning: "When / At the time of (temporal sub-clause anchor)",
        lesson_number: 2,
        sequence_order: 97,
        difficulty_level: "N4"
      },
      {
        id: "48eebc99-9c0b-4ef8-bb6d-6bb9bd389a48" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "あとで",
        base_meaning: "After / Later (sequential action anchor)",
        lesson_number: 2,
        sequence_order: 98,
        difficulty_level: "N4"
      },
      {
        id: "49eebc99-9c0b-4ef8-bb6d-6bb9bd389a49" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "までに",
        base_meaning: "By / Before a certain time (deadline anchor)",
        lesson_number: 2,
        sequence_order: 99,
        difficulty_level: "N4"
      },
      {
        id: "50eebc99-9c0b-4ef8-bb6d-6bb9bd389a50" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ごろ",
        base_meaning: "Around / About (spoken time approximation)",
        lesson_number: 2,
        sequence_order: 100,
        difficulty_level: "N4"
      },
      {
        id: "51eebc99-9c0b-4ef8-bb6d-6bb9bd389a51" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ていた",
        base_meaning: "Past progressive (casually contracted to 〜てた in fast speech)",
        lesson_number: 2,
        sequence_order: 101,
        difficulty_level: "N4"
      },
      {
        id: "52eebc99-9c0b-4ef8-bb6d-6bb9bd389a52" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "るところだ",
        base_meaning: "About to / In the middle of / Just finished doing (aspect modifier)",
        lesson_number: 2,
        sequence_order: 102,
        difficulty_level: "N4"
      },
      {
        id: "53eebc99-9c0b-4ef8-bb6d-6bb9bd389a53" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ていく / 〜てくる",
        base_meaning: "Temporal/spatial direction of actions (usually contracted to 〜てく/〜てきた)",
        lesson_number: 1,
        sequence_order: 103,
        difficulty_level: "N4"
      },
      {
        id: "54eebc99-9c0b-4ef8-bb6d-6bb9bd389a54" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜やすい",
        base_meaning: "Easy to / Likely to (attaches to verb stems)",
        lesson_number: 1,
        sequence_order: 104,
        difficulty_level: "N4"
      },
      {
        id: "55eebc99-9c0b-4ef8-bb6d-6bb9bd389a55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜にくい",
        base_meaning: "Difficult to / Hard to (attaches to verb stems)",
        lesson_number: 1,
        sequence_order: 105,
        difficulty_level: "N4"
      },
      {
        id: "56eebc99-9c0b-4ef8-bb6d-6bb9bd389a56" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜づらい",
        base_meaning: "Subjectively tough / painful to do (attaches to verb stems)",
        lesson_number: 1,
        sequence_order: 106,
        difficulty_level: "N4"
      },
      {
        id: "57eebc99-9c0b-4ef8-bb6d-6bb9bd389a57" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜はじめる",
        base_meaning: "To start doing (compound verb suffix)",
        lesson_number: 2,
        sequence_order: 107,
        difficulty_level: "N4"
      },
      {
        id: "58eebc99-9c0b-4ef8-bb6d-6bb9bd389a58" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜おわる",
        base_meaning: "To finish doing (compound verb suffix)",
        lesson_number: 2,
        sequence_order: 108,
        difficulty_level: "N4"
      },
      {
        id: "59eebc99-9c0b-4ef8-bb6d-6bb9bd389a59" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜なおす",
        base_meaning: "To redo / do over (compound verb suffix)",
        lesson_number: 1,
        sequence_order: 109,
        difficulty_level: "N4"
      },
      {
        id: "60eebc99-9c0b-4ef8-bb6d-6bb9bd389a60" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ないで / なくて",
        base_meaning: "Negative connectives (without doing vs. negative reason/cause)",
        lesson_number: 1,
        sequence_order: 110,
        difficulty_level: "N4"
      },
      {
        id: "61eebc99-9c0b-4ef8-bb6d-6bb9bd389a61" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "のに",
        base_meaning: "Despite / Even though (signals spoken regret, complaint, or surprise)",
        lesson_number: 2,
        sequence_order: 111,
        difficulty_level: "N4"
      },
      {
        id: "62eebc99-9c0b-4ef8-bb6d-6bb9bd389a62" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "でも",
        base_meaning: "Or something / Any (with WH-words) spoken soft suggestions",
        lesson_number: 1,
        sequence_order: 112,
        difficulty_level: "N4"
      },
      {
        id: "63eebc99-9c0b-4ef8-bb6d-6bb9bd389a63" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "れる・られる",
        base_meaning: "Passive voice (often used as suffering/adversative passive in speech)",
        lesson_number: 1,
        sequence_order: 113,
        difficulty_level: "N4"
      },
      {
        id: "64eebc99-9c0b-4ef8-bb6d-6bb9bd389a64" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ということ",
        base_meaning: "Summarization / Spoken clarification (so it means that...)",
        lesson_number: 1,
        sequence_order: 114,
        difficulty_level: "N4"
      },
      {
        id: "65eebc99-9c0b-4ef8-bb6d-6bb9bd389a65" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だけで",
        base_meaning: "Just by / Just with (spoken boundary modifier)",
        lesson_number: 1,
        sequence_order: 115,
        difficulty_level: "N4"
      },
      {
        id: "66eebc99-9c0b-4ef8-bb6d-6bb9bd389a66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なるべく",
        base_meaning: "As much as possible (spoken softening modifier)",
        lesson_number: 2,
        sequence_order: 116,
        difficulty_level: "N4"
      },
      {
        id: "67eebc99-9c0b-4ef8-bb6d-6bb9bd389a67" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ら",
        base_meaning: "Pluralizer for pronouns",
        lesson_number: 1,
        sequence_order: 117,
        difficulty_level: "N4"
      },
      {
        id: "68eebc99-9c0b-4ef8-bb6d-6bb9bd389a68" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だんだん / どんどん",
        base_meaning: "Onomatopoeic spoken pace and change indicators",
        lesson_number: 1,
        sequence_order: 118,
        difficulty_level: "N4"
      },
      {
        id: "69eebc99-9c0b-4ef8-bb6d-6bb9bd389a69" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "とおもう",
        base_meaning: "I think (opinion indicator / spoken statement softener)",
        lesson_number: 3,
        sequence_order: 119,
        difficulty_level: "N4"
      },
      {
        id: "70eebc99-9c0b-4ef8-bb6d-6bb9bd389a70" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "こと",
        base_meaning: "Verb nominalization (the act of / state of doing)",
        lesson_number: 3,
        sequence_order: 120,
        difficulty_level: "N4"
      },
      {
        id: "71eebc99-9c0b-4ef8-bb6d-6bb9bd389a71" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "そう (伝聞・様態)",
        base_meaning: "Look like, Appear, Seem (visually-cued conjectural suffix)",
        lesson_number: 3,
        sequence_order: 121,
        difficulty_level: "N4"
      },
      {
        id: "72eebc99-9c0b-4ef8-bb6d-6bb9bd389a72" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "とか～とか",
        base_meaning: "Casual non-exhaustive spoken listing (things like A and B and stuff)",
        lesson_number: 3,
        sequence_order: 122,
        difficulty_level: "N4"
      },
      {
        id: "73eebc99-9c0b-4ef8-bb6d-6bb9bd389a73" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "そういう",
        base_meaning: "That kind of / Like that (high frequency spoken descriptor)",
        lesson_number: 3,
        sequence_order: 123,
        difficulty_level: "N4"
      },
      {
        id: "74eebc99-9c0b-4ef8-bb6d-6bb9bd389a74" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Verb[よう]",
        base_meaning: "Casual Volitional form (casual let's / I will)",
        lesson_number: 3,
        sequence_order: 124,
        difficulty_level: "N4"
      },
      {
        id: "75eebc99-9c0b-4ef8-bb6d-6bb9bd389a75" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "かな",
        base_meaning: "I wonder (sentence ending particle showing doubt/self-query)",
        lesson_number: 3,
        sequence_order: 125,
        difficulty_level: "N4"
      },
      {
        id: "76eebc99-9c0b-4ef8-bb6d-6bb9bd389a76" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ば / なら",
        base_meaning: "Conditional shifts (If... then / Contextual conditional)",
        lesson_number: 3,
        sequence_order: 126,
        difficulty_level: "N4"
      },
      {
        id: "77eebc99-9c0b-4ef8-bb6d-6bb9bd389a77" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "がる / たがる",
        base_meaning: "Third person emotions & desires (acting as if / wanting to)",
        lesson_number: 3,
        sequence_order: 127,
        difficulty_level: "N4"
      },
      {
        id: "78eebc99-9c0b-4ef8-bb6d-6bb9bd389a78" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "がする",
        base_meaning: "Sensory emission (to give off a smell, sound, taste, or sensation)",
        lesson_number: 3,
        sequence_order: 128,
        difficulty_level: "N4"
      },
      {
        id: "79eebc99-9c0b-4ef8-bb6d-6bb9bd389a79" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "かもしれない",
        base_meaning: "Might / Maybe (casually contracted to かも in speech)",
        lesson_number: 4,
        sequence_order: 129,
        difficulty_level: "N4"
      },
      {
        id: "81eebc99-9c0b-4ef8-bb6d-6bb9bd389a81" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "みたいに・みたいな",
        base_meaning: "Resembling / Like (adverbial and adjectival usage)",
        lesson_number: 4,
        sequence_order: 130,
        difficulty_level: "N4"
      },
      {
        id: "82eebc99-9c0b-4ef8-bb6d-6bb9bd389a82" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "そうに・そうな",
        base_meaning: "Seemingly / Looking like (conjectural modifier)",
        lesson_number: 4,
        sequence_order: 131,
        difficulty_level: "N4"
      },
      {
        id: "83eebc99-9c0b-4ef8-bb6d-6bb9bd389a83" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ようと思う",
        base_meaning: "Thinking of doing (volitional + と思う spoken plan indicator)",
        lesson_number: 4,
        sequence_order: 132,
        difficulty_level: "N4"
      },
      {
        id: "84eebc99-9c0b-4ef8-bb6d-6bb9bd389a84" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜にする / 〜くする",
        base_meaning: "To make something / To choose to do (active state change)",
        lesson_number: 4,
        sequence_order: 133,
        difficulty_level: "N4"
      },
      {
        id: "85eebc99-9c0b-4ef8-bb6d-6bb9bd389a85" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "といい",
        base_meaning: "I hope / You should (expressing hopes and giving soft advice)",
        lesson_number: 4,
        sequence_order: 134,
        difficulty_level: "N4"
      },
      {
        id: "86eebc99-9c0b-4ef8-bb6d-6bb9bd389a86" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ようになる",
        base_meaning: "To reach the point of / Come to be that (habitual/ability change)",
        lesson_number: 4,
        sequence_order: 135,
        difficulty_level: "N4"
      },
      {
        id: "87eebc99-9c0b-4ef8-bb6d-6bb9bd389a87" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "じゃないか",
        base_meaning: "Isn't it? (spoken tag question, casually contracted to じゃん)",
        lesson_number: 4,
        sequence_order: 136,
        difficulty_level: "N4"
      },
      {
        id: "88eebc99-9c0b-4ef8-bb6d-6bb9bd389a88" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "らしい",
        base_meaning: "Seems like / Apparently (reliable hearsay/typicality indicator)",
        lesson_number: 4,
        sequence_order: 137,
        difficulty_level: "N4"
      },
      {
        id: "89eebc99-9c0b-4ef8-bb6d-6bb9bd389a89" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "てほしい",
        base_meaning: "I want you to do (expressing desires/requests of others)",
        lesson_number: 4,
        sequence_order: 138,
        difficulty_level: "N4"
      },
      {
        id: "91eebc99-9c0b-4ef8-bb6d-6bb9bd389a91" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "聞こえる / 見える",
        base_meaning: "Audible / Visible (natural spoken passive perception)",
        lesson_number: 4,
        sequence_order: 140,
        difficulty_level: "N4"
      },
      {
        id: "92eebc99-9c0b-4ef8-bb6d-6bb9bd389a92" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "～代",
        base_meaning: "Decades/Ages suffix (~dai) or Cost/Bill marker (e.g. denki-dai)",
        lesson_number: 5,
        sequence_order: 141,
        difficulty_level: "N4"
      },
      {
        id: "93eebc99-9c0b-4ef8-bb6d-6bb9bd389a93" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "かかる / する (コスト)",
        base_meaning: "Takes (time) / Costs (money) spoken anchors",
        lesson_number: 5,
        sequence_order: 142,
        difficulty_level: "N4"
      },
      {
        id: "94eebc99-9c0b-4ef8-bb6d-6bb9bd389a94" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Number + も",
        base_meaning: "Emphasis on high quantity (as much/many as)",
        lesson_number: 5,
        sequence_order: 143,
        difficulty_level: "N4"
      },
      {
        id: "95eebc99-9c0b-4ef8-bb6d-6bb9bd389a95" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ほとんど",
        base_meaning: "Almost all / Hardly any (spoken quantifier modifier)",
        lesson_number: 5,
        sequence_order: 144,
        difficulty_level: "N4"
      },
      {
        id: "96eebc99-9c0b-4ef8-bb6d-6bb9bd389a96" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "そんな・こんな・あんな・どんな",
        base_meaning: "Demonstrative spoken qualifiers (that kind of / what kind of)",
        lesson_number: 5,
        sequence_order: 145,
        difficulty_level: "N4"
      },
      {
        id: "97eebc99-9c0b-4ef8-bb6d-6bb9bd389a97" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "以上 / 以外",
        base_meaning: "More than / Other than (ubiquitous spoken limit and exclusion markers)",
        lesson_number: 5,
        sequence_order: 146,
        difficulty_level: "N4"
      },
      {
        id: "98eebc99-9c0b-4ef8-bb6d-6bb9bd389a98" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ずっと",
        base_meaning: "Continuously / Far more (high frequency spoken modifier)",
        lesson_number: 5,
        sequence_order: 147,
        difficulty_level: "N4"
      },
      {
        id: "99eebc99-9c0b-4ef8-bb6d-6bb9bd389a99" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だいたい",
        base_meaning: "Generally / Roughly (essential conversational hedge/approximation)",
        lesson_number: 5,
        sequence_order: 148,
        difficulty_level: "N4"
      },
      {
        id: "00eebc99-9c0b-4ef8-bb6d-6bb9bd389b00" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なん + counter + か",
        base_meaning: "Approximate spoken counts (some / several, e.g. nanninka)",
        lesson_number: 5,
        sequence_order: 149,
        difficulty_level: "N4"
      },
      {
        id: "01eebc99-9c0b-4ef8-bb6d-6bb9bd389b01" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "真(っ)",
        base_meaning: "Completely / Exactly (emphatic prefix for colors/directions, e.g. masshiro)",
        lesson_number: 5,
        sequence_order: 150,
        difficulty_level: "N4"
      },
      {
        id: "02eebc99-9c0b-4ef8-bb6d-6bb9bd389b02" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Number + しか〜ない",
        base_meaning: "Negative boundary limiter (only / nothing but)",
        lesson_number: 5,
        sequence_order: 151,
        difficulty_level: "N4"
      },
      {
        id: "03eebc99-9c0b-4ef8-bb6d-6bb9bd389b03" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "すこしも～ない",
        base_meaning: "Intensified negation (not in the least / not at all)",
        lesson_number: 5,
        sequence_order: 152,
        difficulty_level: "N4"
      },
      {
        id: "04eebc99-9c0b-4ef8-bb6d-6bb9bd389b04" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ばあいは",
        base_meaning: "In the event of / In case of (contextual conditional)",
        lesson_number: 6,
        sequence_order: 153,
        difficulty_level: "N4"
      },
      {
        id: "05eebc99-9c0b-4ef8-bb6d-6bb9bd389b05" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "てよかった",
        base_meaning: "I'm glad that... (expressing relief or positive outcomes)",
        lesson_number: 6,
        sequence_order: 154,
        difficulty_level: "N4"
      },
      {
        id: "06eebc99-9c0b-4ef8-bb6d-6bb9bd389b06" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Verb［せる・させる］",
        base_meaning: "Causative Voice (make or let someone do an action)",
        lesson_number: 6,
        sequence_order: 155,
        difficulty_level: "N4"
      },
      {
        id: "07eebc99-9c0b-4ef8-bb6d-6bb9bd389b07" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ても・〜でも",
        base_meaning: "Even if / Even though (concessive conditional)",
        lesson_number: 6,
        sequence_order: 156,
        difficulty_level: "N4"
      },
      {
        id: "08eebc99-9c0b-4ef8-bb6d-6bb9bd389b08" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "てしまう / ちゃう",
        base_meaning: "Regret / Finality contraction (accidentally or completely did something)",
        lesson_number: 6,
        sequence_order: 157,
        difficulty_level: "N4"
      },
      {
        id: "09eebc99-9c0b-4ef8-bb6d-6bb9bd389b09" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "させられる",
        base_meaning: "Causative-Passive Voice (forced / made to do something against will)",
        lesson_number: 6,
        sequence_order: 158,
        difficulty_level: "N4"
      },
      {
        id: "10eebc99-9c0b-4ef8-bb6d-6bb9bd389b10" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "てある",
        base_meaning: "State resulting from an intentional action (remaining prep state)",
        lesson_number: 6,
        sequence_order: 159,
        difficulty_level: "N4"
      },
      {
        id: "11eebc99-9c0b-4ef8-bb6d-6bb9bd389b11" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ているあいだに",
        base_meaning: "While / During the time that (durational boundary)",
        lesson_number: 6,
        sequence_order: 160,
        difficulty_level: "N4"
      },
      {
        id: "12eebc99-9c0b-4ef8-bb6d-6bb9bd389b12" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なくてもいい",
        base_meaning: "Permissive Negation (don't have to do / not required)",
        lesson_number: 6,
        sequence_order: 161,
        difficulty_level: "N4"
      },
      {
        id: "13eebc99-9c0b-4ef8-bb6d-6bb9bd389b13" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "てみる",
        base_meaning: "Trial Action (try doing something to see the outcome)",
        lesson_number: 6,
        sequence_order: 162,
        difficulty_level: "N4"
      },
      {
        id: "15eebc99-9c0b-4ef8-bb6d-6bb9bd389b15" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜てあげる / 〜てくれる / 〜てもらう",
        base_meaning: "Benefactive action verbs (performing favors for others/me)",
        lesson_number: 7,
        sequence_order: 164,
        difficulty_level: "N4"
      },
      {
        id: "17eebc99-9c0b-4ef8-bb6d-6bb9bd389b17" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜てくれてありがとう",
        base_meaning: "Spoken expression of gratitude for someone's action (thank you for doing)",
        lesson_number: 7,
        sequence_order: 166,
        difficulty_level: "N4"
      },
      {
        id: "18eebc99-9c0b-4ef8-bb6d-6bb9bd389b18" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜てくれない / 〜てもらえない",
        base_meaning: "Default casual spoken request triggers (Can/Could you do...?)",
        lesson_number: 7,
        sequence_order: 167,
        difficulty_level: "N4"
      },
      {
        id: "23eebc99-9c0b-4ef8-bb6d-6bb9bd389b23" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "たら",
        base_meaning: "The dominant conditional in spoken Japanese (If... / When...)",
        lesson_number: 8,
        sequence_order: 172,
        difficulty_level: "N4"
      },
      {
        id: "24eebc99-9c0b-4ef8-bb6d-6bb9bd389b24" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ほかに",
        base_meaning: "Other, besides / In addition (conversational transition/limiter)",
        lesson_number: 8,
        sequence_order: 173,
        difficulty_level: "N4"
      },
      {
        id: "25eebc99-9c0b-4ef8-bb6d-6bb9bd389b25" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "そんなに",
        base_meaning: "So much / That much (spoken qualifier often paired with negatives)",
        lesson_number: 8,
        sequence_order: 174,
        difficulty_level: "N4"
      },
      {
        id: "26eebc99-9c0b-4ef8-bb6d-6bb9bd389b26" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "れる・られる (可能)",
        base_meaning: "Action Potential Voice (to be able to do, e.g. hanaseru)",
        lesson_number: 8,
        sequence_order: 175,
        difficulty_level: "N4"
      },
      {
        id: "27eebc99-9c0b-4ef8-bb6d-6bb9bd389b27" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "んだけど / んですが",
        base_meaning: "Spoken conversational preamble / softener (I want to, but...)",
        lesson_number: 8,
        sequence_order: 176,
        difficulty_level: "N4"
      },
      {
        id: "28eebc99-9c0b-4ef8-bb6d-6bb9bd389b28" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "はずだ / はずがない",
        base_meaning: "Expectation markers (should be the case / no way that...)",
        lesson_number: 8,
        sequence_order: 177,
        difficulty_level: "N4"
      },
      {
        id: "29eebc99-9c0b-4ef8-bb6d-6bb9bd389b29" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "かどうか",
        base_meaning: "Choice and conditional boundary (whether or not)",
        lesson_number: 8,
        sequence_order: 178,
        difficulty_level: "N4"
      },
      {
        id: "30eebc99-9c0b-4ef8-bb6d-6bb9bd389b30" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "と (条件)",
        base_meaning: "Natural consequence conditional (If/Whenever... then...)",
        lesson_number: 8,
        sequence_order: 179,
        difficulty_level: "N4"
      },
      {
        id: "31eebc99-9c0b-4ef8-bb6d-6bb9bd389b31" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ないと",
        base_meaning: "Casual spoken obligation (Must do / Have to do)",
        lesson_number: 8,
        sequence_order: 180,
        difficulty_level: "N4"
      },
      {
        id: "32eebc99-9c0b-4ef8-bb6d-6bb9bd389b32" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だけでなく",
        base_meaning: "Additive spoken connector (Not only... but also...)",
        lesson_number: 8,
        sequence_order: 181,
        difficulty_level: "N4"
      },
      {
        id: "33eebc99-9c0b-4ef8-bb6d-6bb9bd389b33" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "かい",
        base_meaning: "Casual question ending particle (usually masculine/older speakers)",
        lesson_number: 8,
        sequence_order: 182,
        difficulty_level: "N4"
      },
      {
        id: "34eebc99-9c0b-4ef8-bb6d-6bb9bd389b34" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "もし",
        base_meaning: "Emphatic conditional preview signal (prepares listener for an 'if')",
        lesson_number: 8,
        sequence_order: 183,
        difficulty_level: "N4"
      },
      {
        id: "35eebc99-9c0b-4ef8-bb6d-6bb9bd389b35" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "し",
        base_meaning: "Spoken reason enumerator (A, and B, and... / also)",
        lesson_number: 9,
        sequence_order: 184,
        difficulty_level: "N4"
      },
      {
        id: "36eebc99-9c0b-4ef8-bb6d-6bb9bd389b36" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ながら",
        base_meaning: "Simultaneous Action (while doing / as)",
        lesson_number: 9,
        sequence_order: 185,
        difficulty_level: "N4"
      },
      {
        id: "37eebc99-9c0b-4ef8-bb6d-6bb9bd389b37" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ようにする",
        base_meaning: "To try to / Make sure to (spoken indicator of habit or effort)",
        lesson_number: 9,
        sequence_order: 186,
        difficulty_level: "N4"
      },
      {
        id: "39eebc99-9c0b-4ef8-bb6d-6bb9bd389b39" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜つづける",
        base_meaning: "To continue doing (compound verb suffix)",
        lesson_number: 9,
        sequence_order: 188,
        difficulty_level: "N4"
      },
      {
        id: "40eebc99-9c0b-4ef8-bb6d-6bb9bd389b40" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ようにいう",
        base_meaning: "Indirect spoken commands/requests (told them to / ordered to do)",
        lesson_number: 9,
        sequence_order: 189,
        difficulty_level: "N4"
      },
      {
        id: "41eebc99-9c0b-4ef8-bb6d-6bb9bd389b41" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "よていだ",
        base_meaning: "To plan to / Intend to (future intent indicator)",
        lesson_number: 9,
        sequence_order: 190,
        difficulty_level: "N4"
      },
      {
        id: "42eebc99-9c0b-4ef8-bb6d-6bb9bd389b42" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜たばかり",
        base_meaning: "Just did / Freshly completed action (subjective recency)",
        lesson_number: 9,
        sequence_order: 191,
        difficulty_level: "N4"
      },
      {
        id: "43eebc99-9c0b-4ef8-bb6d-6bb9bd389b43" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "命令形 (動詞)",
        base_meaning: "Blunt spoken imperative / command form (e.g. Ike! / Yamero!)",
        lesson_number: 9,
        sequence_order: 192,
        difficulty_level: "N4"
      },
      {
        id: "44eebc99-9c0b-4ef8-bb6d-6bb9bd389b44" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ように (目的)",
        base_meaning: "So that / In order to (intent and purpose connector)",
        lesson_number: 10,
        sequence_order: 193,
        difficulty_level: "N4"
      },
      {
        id: "45eebc99-9c0b-4ef8-bb6d-6bb9bd389b45" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "かしら",
        base_meaning: "I wonder (sentence ending particle showing curiosity - feminine)",
        lesson_number: 10,
        sequence_order: 194,
        difficulty_level: "N4"
      },
      {
        id: "46eebc99-9c0b-4ef8-bb6d-6bb9bd389b46" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "って感じ",
        base_meaning: "Colloquial spoken filler (kind of vibe / has that feeling)",
        lesson_number: 10,
        sequence_order: 195,
        difficulty_level: "N4"
      },
      {
        id: "47eebc99-9c0b-4ef8-bb6d-6bb9bd389b47" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "風",
        base_meaning: "Suffix denoting style, fashion, or way (~fuu, e.g. onna-fuu)",
        lesson_number: 10,
        sequence_order: 196,
        difficulty_level: "N4"
      },
      {
        id: "48eebc99-9c0b-4ef8-bb6d-6bb9bd389b48" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "にきがつく",
        base_meaning: "To notice / To realize (moment of spoken realization)",
        lesson_number: 10,
        sequence_order: 197,
        difficulty_level: "N4"
      },
      {
        id: "49eebc99-9c0b-4ef8-bb6d-6bb9bd389b49" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "それに",
        base_meaning: "Conversational additive connector (besides / moreover)",
        lesson_number: 10,
        sequence_order: 198,
        difficulty_level: "N4"
      },
      {
        id: "50eebc99-9c0b-4ef8-bb6d-6bb9bd389b50" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "それで",
        base_meaning: "Spoken cause connector / conversational prompter (Therefore / And then?)",
        lesson_number: 10,
        sequence_order: 199,
        difficulty_level: "N4"
      },
      {
        id: "51eebc99-9c0b-4ef8-bb6d-6bb9bd389b51" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Question-phrase + か",
        base_meaning: "Nested indirect questions embedded within sentences",
        lesson_number: 10,
        sequence_order: 200,
        difficulty_level: "N4"
      },
      {
        id: "52eebc99-9c0b-4ef8-bb6d-6bb9bd389b52" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "それでも",
        base_meaning: "Conversational concessive connector (but still / even so)",
        lesson_number: 10,
        sequence_order: 201,
        difficulty_level: "N4"
      },
      {
        id: "53eebc99-9c0b-4ef8-bb6d-6bb9bd389b53" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "たらどう",
        base_meaning: "Casual spoken suggestion / advice (Why don't you...?)",
        lesson_number: 10,
        sequence_order: 202,
        difficulty_level: "N4"
      },
      {
        id: "54eebc99-9c0b-4ef8-bb6d-6bb9bd389b54" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "といわれている",
        base_meaning: "It is said that / Known as (spoken reputation/hearsay marker)",
        lesson_number: 10,
        sequence_order: 203,
        difficulty_level: "N4"
      },
      {
        id: "55eebc99-9c0b-4ef8-bb6d-6bb9bd389b55" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ばよかった",
        base_meaning: "Spoken regret (should have done / wish I had done)",
        lesson_number: 10,
        sequence_order: 204,
        difficulty_level: "N4"
      },
      {
        id: "56eebc99-9c0b-4ef8-bb6d-6bb9bd389b56" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ばいい",
        base_meaning: "Suggestion / Spoken advice trigger (Should do / It'd be good if)",
        lesson_number: 1,
        sequence_order: 205,
        difficulty_level: "N3"
      },
      {
        id: "57eebc99-9c0b-4ef8-bb6d-6bb9bd389b57" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "中",
        base_meaning: "Suffix denoting ongoing action/process (~chuu, e.g. shigoto-chuu)",
        lesson_number: 1,
        sequence_order: 206,
        difficulty_level: "N3"
      },
      {
        id: "58eebc99-9c0b-4ef8-bb6d-6bb9bd389b58" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "うちに / ないうちに",
        base_meaning: "Temporal modifier (While / Before state changes)",
        lesson_number: 1,
        sequence_order: 207,
        difficulty_level: "N3"
      },
      {
        id: "59eebc99-9c0b-4ef8-bb6d-6bb9bd389b59" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "べき / べきではない",
        base_meaning: "Strong obligation/moral expectation (Should / Must do)",
        lesson_number: 1,
        sequence_order: 208,
        difficulty_level: "N3"
      },
      {
        id: "60eebc99-9c0b-4ef8-bb6d-6bb9bd389b60" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なかなか",
        base_meaning: "Spoken degree modifier (quite, considerably)",
        lesson_number: 1,
        sequence_order: 209,
        difficulty_level: "N3"
      },
      {
        id: "61eebc99-9c0b-4ef8-bb6d-6bb9bd389b61" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なかなか〜ない",
        base_meaning: "Negative expectation limiter (hardly / not easily done)",
        lesson_number: 1,
        sequence_order: 210,
        difficulty_level: "N3"
      },
      {
        id: "63eebc99-9c0b-4ef8-bb6d-6bb9bd389b63" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "によって",
        base_meaning: "Depends on / Due to (highly active spoken connective)",
        lesson_number: 1,
        sequence_order: 212,
        difficulty_level: "N3"
      },
      {
        id: "64eebc99-9c0b-4ef8-bb6d-6bb9bd389b64" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "全く〜ない",
        base_meaning: "Intensified negation (not at all)",
        lesson_number: 1,
        sequence_order: 213,
        difficulty_level: "N3"
      },
      {
        id: "66eebc99-9c0b-4ef8-bb6d-6bb9bd389b66" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "させてもらう",
        base_meaning: "Humble permission seeker/indicator (take the liberty to do)",
        lesson_number: 1,
        sequence_order: 215,
        difficulty_level: "N3"
      },
      {
        id: "67eebc99-9c0b-4ef8-bb6d-6bb9bd389b67" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Particle + の",
        base_meaning: "Conjunctive particle noun modifier (e.g. kara no tegami)",
        lesson_number: 2,
        sequence_order: 216,
        difficulty_level: "N3"
      },
      {
        id: "68eebc99-9c0b-4ef8-bb6d-6bb9bd389b68" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ところが / ところで",
        base_meaning: "Conversational contrast / Topic-switching connectives (However / By the way)",
        lesson_number: 2,
        sequence_order: 217,
        difficulty_level: "N3"
      },
      {
        id: "69eebc99-9c0b-4ef8-bb6d-6bb9bd389b69" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ほど / ほど〜ない",
        base_meaning: "Extent / Negative Comparison (to the extent of / not as... as)",
        lesson_number: 2,
        sequence_order: 218,
        difficulty_level: "N3"
      },
      {
        id: "70eebc99-9c0b-4ef8-bb6d-6bb9bd389b70" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ば〜ほど",
        base_meaning: "Proportional comparison (the more... the more)",
        lesson_number: 2,
        sequence_order: 219,
        difficulty_level: "N3"
      },
      {
        id: "72eebc99-9c0b-4ef8-bb6d-6bb9bd389b72" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "という / というのは",
        base_meaning: "Definition/Naming (called / what ... means is)",
        lesson_number: 2,
        sequence_order: 221,
        difficulty_level: "N3"
      },
      {
        id: "73eebc99-9c0b-4ef8-bb6d-6bb9bd389b73" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "的",
        base_meaning: "Suffix converting nouns to descriptive qualities (-style / -like / -al)",
        lesson_number: 2,
        sequence_order: 222,
        difficulty_level: "N3"
      },
      {
        id: "74eebc99-9c0b-4ef8-bb6d-6bb9bd389b74" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "もの / もん",
        base_meaning: "Casual spoke excuse ending (because / cause...)",
        lesson_number: 2,
        sequence_order: 223,
        difficulty_level: "N3"
      },
      {
        id: "75eebc99-9c0b-4ef8-bb6d-6bb9bd389b75" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ものだ",
        base_meaning: "Social expectation / General truth (supposed to / ought to)",
        lesson_number: 2,
        sequence_order: 224,
        difficulty_level: "N3"
      },
      {
        id: "76eebc99-9c0b-4ef8-bb6d-6bb9bd389b76" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "おかげで",
        base_meaning: "Positive credit cause (thanks to / because of)",
        lesson_number: 2,
        sequence_order: 225,
        difficulty_level: "N3"
      },
      {
        id: "77eebc99-9c0b-4ef8-bb6d-6bb9bd389b77" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "こそ / からこそ",
        base_meaning: "Emphasis / Expressing 'precisely' or 'especially because' (emotional cause)",
        lesson_number: 3,
        sequence_order: 226,
        difficulty_level: "N3"
      },
      {
        id: "78eebc99-9c0b-4ef8-bb6d-6bb9bd389b78" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ばかり",
        base_meaning: "Nothing but / Only (focusing on one exclusive action, e.g. tabete bakari)",
        lesson_number: 3,
        sequence_order: 227,
        difficulty_level: "N3"
      },
      {
        id: "79eebc99-9c0b-4ef8-bb6d-6bb9bd389b79" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ばかりに",
        base_meaning: "Simply because / Only on account of (unfortunate result from single cause)",
        lesson_number: 3,
        sequence_order: 228,
        difficulty_level: "N3"
      },
      {
        id: "80eebc99-9c0b-4ef8-bb6d-6bb9bd389b80" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ことがある (頻度)",
        base_meaning: "There are times when / Occasionally (habitual frequency indicator)",
        lesson_number: 3,
        sequence_order: 229,
        difficulty_level: "N3"
      },
      {
        id: "81eebc99-9c0b-4ef8-bb6d-6bb9bd389b81" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ことにする / ことになる",
        base_meaning: "Subjective decision (decide to) vs. Objective decision (it has been decided that)",
        lesson_number: 3,
        sequence_order: 230,
        difficulty_level: "N3"
      },
      {
        id: "82eebc99-9c0b-4ef8-bb6d-6bb9bd389b82" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ことはない",
        base_meaning: "No need to do / Reassurance advice pattern",
        lesson_number: 3,
        sequence_order: 231,
        difficulty_level: "N3"
      },
      {
        id: "83eebc99-9c0b-4ef8-bb6d-6bb9bd389b83" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "～と言っても",
        base_meaning: "Concession marker (although / even though I say...)",
        lesson_number: 3,
        sequence_order: 232,
        difficulty_level: "N3"
      },
      {
        id: "84eebc99-9c0b-4ef8-bb6d-6bb9bd389b84" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "といえば",
        base_meaning: "Conversational association trigger (speaking of...)",
        lesson_number: 3,
        sequence_order: 233,
        difficulty_level: "N3"
      },
      {
        id: "85eebc99-9c0b-4ef8-bb6d-6bb9bd389b85" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜合う",
        base_meaning: "Reciprocal action verb suffix (do with/for each other, e.g. tasuke-au)",
        lesson_number: 3,
        sequence_order: 234,
        difficulty_level: "N3"
      },
      {
        id: "86eebc99-9c0b-4ef8-bb6d-6bb9bd389b86" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "について",
        base_meaning: "Regarding / About (the default spoken topic introducer)",
        lesson_number: 3,
        sequence_order: 235,
        difficulty_level: "N3"
      },
      {
        id: "87eebc99-9c0b-4ef8-bb6d-6bb9bd389b87" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ちゃんと",
        base_meaning: "Spoken adverb denoting properly, neatly, or sufficiently",
        lesson_number: 3,
        sequence_order: 236,
        difficulty_level: "N3"
      },
      {
        id: "89eebc99-9c0b-4ef8-bb6d-6bb9bd389b89" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "に比べて",
        base_meaning: "Comparison anchor (compared to / in comparison with)",
        lesson_number: 4,
        sequence_order: 238,
        difficulty_level: "N3"
      },
      {
        id: "90eebc99-9c0b-4ef8-bb6d-6bb9bd389b90" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "どんなに〜ても / いくら〜でも",
        base_meaning: "Concessive intensifiers (no matter how much... happens)",
        lesson_number: 4,
        sequence_order: 239,
        difficulty_level: "N3"
      },
      {
        id: "91eebc99-9c0b-4ef8-bb6d-6bb9bd389b91" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "かなり",
        base_meaning: "Degree modifier (quite / considerably / pretty)",
        lesson_number: 4,
        sequence_order: 240,
        difficulty_level: "N3"
      },
      {
        id: "92eebc99-9c0b-4ef8-bb6d-6bb9bd389b92" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "あまりに",
        base_meaning: "Excess adverb modifier (way too... / so much... that)",
        lesson_number: 4,
        sequence_order: 241,
        difficulty_level: "N3"
      },
      {
        id: "93eebc99-9c0b-4ef8-bb6d-6bb9bd389b93" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "わけだ / わけではない",
        base_meaning: "Logical conclusion (no wonder) vs. Partial negation (it's not that...)",
        lesson_number: 4,
        sequence_order: 242,
        difficulty_level: "N3"
      },
      {
        id: "94eebc99-9c0b-4ef8-bb6d-6bb9bd389b94" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ところだった",
        base_meaning: "Near-miss spoken aspect marker (almost / on the verge of doing)",
        lesson_number: 4,
        sequence_order: 243,
        difficulty_level: "N3"
      },
      {
        id: "95eebc99-9c0b-4ef8-bb6d-6bb9bd389b95" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だって / んだって",
        base_meaning: "Spoken connective ('because/but') and highly active casual hearsay ('I heard...')",
        lesson_number: 4,
        sequence_order: 244,
        difficulty_level: "N3"
      },
      {
        id: "96eebc99-9c0b-4ef8-bb6d-6bb9bd389b96" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "に対して",
        base_meaning: "Focus contrast / Target orientation (in contrast to / toward)",
        lesson_number: 4,
        sequence_order: 245,
        difficulty_level: "N3"
      },
      {
        id: "97eebc99-9c0b-4ef8-bb6d-6bb9bd389b97" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "さ (フィラー・間投詞)",
        base_meaning: "Colloquial spoken filler and sentence topic indicator (like / you see / you know)",
        lesson_number: 4,
        sequence_order: 246,
        difficulty_level: "N3"
      },
      {
        id: "98eebc99-9c0b-4ef8-bb6d-6bb9bd389b98" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "それぞれ",
        base_meaning: "Divider / spoken distribution marker (each / respectively)",
        lesson_number: 4,
        sequence_order: 247,
        difficulty_level: "N3"
      },
      {
        id: "99eebc99-9c0b-4ef8-bb6d-6bb9bd389b99" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "まま",
        base_meaning: "As is / Remaining in a state (aspect modifier, e.g. aketa mama)",
        lesson_number: 5,
        sequence_order: 248,
        difficulty_level: "N3"
      },
      {
        id: "9beebc99-9c0b-4ef8-bb6d-6bb9bd389b9b" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "しかない",
        base_meaning: "Have no choice but to / Only option left (strong limit)",
        lesson_number: 5,
        sequence_order: 250,
        difficulty_level: "N3"
      },
      {
        id: "9deebc99-9c0b-4ef8-bb6d-6bb9bd389b9d" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "～ても～なくても",
        base_meaning: "Whether ~ or not (double concessive conditional)",
        lesson_number: 5,
        sequence_order: 252,
        difficulty_level: "N3"
      },
      {
        id: "9eeebc99-9c0b-4ef8-bb6d-6bb9bd389b9e" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "んじゃない",
        base_meaning: "Colloquial spoken tag question (isn't it? / shouldn't you?)",
        lesson_number: 5,
        sequence_order: 253,
        difficulty_level: "N3"
      },
      {
        id: "9feebc99-9c0b-4ef8-bb6d-6bb9bd389b9f" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "わけがない",
        base_meaning: "Strong negative logical deduction (no way that... / impossible)",
        lesson_number: 5,
        sequence_order: 254,
        difficulty_level: "N3"
      },
      {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd389ba0" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "としたら / とすると",
        base_meaning: "Spoken hypothetical assumption (assuming that / if...)",
        lesson_number: 5,
        sequence_order: 255,
        difficulty_level: "N3"
      },
      {
        id: "a1eebc99-9c0b-4ef8-bb6d-6bb9bd389ba1" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "として",
        base_meaning: "Role marker (as / in the capacity of)",
        lesson_number: 5,
        sequence_order: 256,
        difficulty_level: "N3"
      },
      {
        id: "a2eebc99-9c0b-4ef8-bb6d-6bb9bd389ba2" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "にしては",
        base_meaning: "Expectation mismatch evaluator (even considering / for)",
        lesson_number: 5,
        sequence_order: 257,
        difficulty_level: "N3"
      },
      {
        id: "a3eebc99-9c0b-4ef8-bb6d-6bb9bd389ba3" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "にしても",
        base_meaning: "Concessive modifier (even so / regardless of that)",
        lesson_number: 5,
        sequence_order: 258,
        difficulty_level: "N3"
      },
      {
        id: "a4eebc99-9c0b-4ef8-bb6d-6bb9bd389ba4" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "にとって",
        base_meaning: "Perspective target evaluator (to / for [someone])",
        lesson_number: 5,
        sequence_order: 259,
        difficulty_level: "N3"
      },
      {
        id: "a5eebc99-9c0b-4ef8-bb6d-6bb9bd389ba5" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "というより",
        base_meaning: "Conversational reframing/correction (rather than saying / more like)",
        lesson_number: 5,
        sequence_order: 260,
        difficulty_level: "N3"
      },
      {
        id: "a6eebc99-9c0b-4ef8-bb6d-6bb9bd389ba6" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "はもちろん",
        base_meaning: "Additive focus limiter (of course / not to mention)",
        lesson_number: 5,
        sequence_order: 261,
        difficulty_level: "N3"
      },
      {
        id: "a7eebc99-9c0b-4ef8-bb6d-6bb9bd389ba7" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "て初めて",
        base_meaning: "Time sequence condition (only after doing / not until)",
        lesson_number: 5,
        sequence_order: 262,
        difficulty_level: "N3"
      },
      {
        id: "a8eebc99-9c0b-4ef8-bb6d-6bb9bd389ba8" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "さえ / さえ〜ば",
        base_meaning: "Extreme focus limiter and exclusive conditional (even / if only...)",
        lesson_number: 5,
        sequence_order: 263,
        difficulty_level: "N3"
      },
      {
        id: "a9eebc99-9c0b-4ef8-bb6d-6bb9bd389ba9" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "たものだ",
        base_meaning: "Nostalgic past reminiscence (used to do routinely)",
        lesson_number: 5,
        sequence_order: 264,
        difficulty_level: "N3"
      },
      {
        id: "aaeebc99-9c0b-4ef8-bb6d-6bb9bd389baa" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "さて",
        base_meaning: "Well / Well then (spoken dialogue transition)",
        lesson_number: 6,
        sequence_order: 265,
        difficulty_level: "N3"
      },
      {
        id: "abeebc99-9c0b-4ef8-bb6d-6bb9bd389bab" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "むしろ",
        base_meaning: "Rather / Instead (spoken choice reframing)",
        lesson_number: 6,
        sequence_order: 266,
        difficulty_level: "N3"
      },
      {
        id: "aceebc99-9c0b-4ef8-bb6d-6bb9bd389bac" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "つまり",
        base_meaning: "In other words / In short (essential spoken clarification/summarizer)",
        lesson_number: 6,
        sequence_order: 267,
        difficulty_level: "N3"
      },
      {
        id: "adeebc99-9c0b-4ef8-bb6d-6bb9bd389bad" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "かえって",
        base_meaning: "Conversely / On the contrary (showing unexpected contrast results)",
        lesson_number: 6,
        sequence_order: 268,
        difficulty_level: "N3"
      },
      {
        id: "aeeebc99-9c0b-4ef8-bb6d-6bb9bd389bae" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜気がする",
        base_meaning: "To have a feeling that / Feel like (extremely active spoken uncertainty hedge)",
        lesson_number: 6,
        sequence_order: 269,
        difficulty_level: "N3"
      },
      {
        id: "afeebc99-9c0b-4ef8-bb6d-6bb9bd389baf" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "とても〜ない",
        base_meaning: "Cannot at all / Completely impossible (strong spoken negation modifier)",
        lesson_number: 6,
        sequence_order: 270,
        difficulty_level: "N3"
      },
      {
        id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd389bb0" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "別に〜ない",
        base_meaning: "Not particularly / Not really (highly active spoken indifference marker)",
        lesson_number: 6,
        sequence_order: 271,
        difficulty_level: "N3"
      },
      {
        id: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd389bb1" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "じゃなくて",
        base_meaning: "Not A but B (immediate conversational correction connective)",
        lesson_number: 6,
        sequence_order: 272,
        difficulty_level: "N3"
      },
      {
        id: "b3eebc99-9c0b-4ef8-bb6d-6bb9bd389bb3" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "わけにはいかない",
        base_meaning: "Cannot afford to / Impossible to do (social/moral boundary restriction)",
        lesson_number: 6,
        sequence_order: 274,
        difficulty_level: "N3"
      },
      {
        id: "b4eebc99-9c0b-4ef8-bb6d-6bb9bd389bb4" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ようとしない",
        base_meaning: "Will not attempt to / Refuses to (describing third-party stubbornness)",
        lesson_number: 6,
        sequence_order: 275,
        difficulty_level: "N3"
      },
      {
        id: "b5eebc99-9c0b-4ef8-bb6d-6bb9bd389bb5" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "もしかしたら",
        base_meaning: "Perhaps / Maybe (acoustic uncertainty signal)",
        lesson_number: 6,
        sequence_order: 276,
        difficulty_level: "N3"
      },
      {
        id: "b7eebc99-9c0b-4ef8-bb6d-6bb9bd389bb7" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜かというと",
        base_meaning: "If you ask why/which... (spoken dialogue framing and reason explanation)",
        lesson_number: 6,
        sequence_order: 278,
        difficulty_level: "N3"
      },
      {
        id: "b8eebc99-9c0b-4ef8-bb6d-6bb9bd389bb8" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜ずつ",
        base_meaning: "Each / One at a time (spoken distribution modifier)",
        lesson_number: 7,
        sequence_order: 279,
        difficulty_level: "N3"
      },
      {
        id: "b9eebc99-9c0b-4ef8-bb6d-6bb9bd389bb9" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "だらけ",
        base_meaning: "Covered in / Full of (spoken suffix denoting an excess negative state, e.g. doro-darake)",
        lesson_number: 7,
        sequence_order: 280,
        difficulty_level: "N3"
      },
      {
        id: "baeebc99-9c0b-4ef8-bb6d-6bb9bd389bba" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜み",
        base_meaning: "Noun-forming spoken suffix indicating physical/emotional state (e.g. itami, fukami)",
        lesson_number: 7,
        sequence_order: 281,
        difficulty_level: "N3"
      },
      {
        id: "bbeebc99-9c0b-4ef8-bb6d-6bb9bd389bbb" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜と違って",
        base_meaning: "Contrastive comparison framework (unlike / different from)",
        lesson_number: 7,
        sequence_order: 282,
        difficulty_level: "N3"
      },
      {
        id: "bceebc99-9c0b-4ef8-bb6d-6bb9bd389bbc" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "に違いない",
        base_meaning: "Must be / No doubt that (spoken deduction showing high certainty)",
        lesson_number: 7,
        sequence_order: 283,
        difficulty_level: "N3"
      },
      {
        id: "bdeebc99-9c0b-4ef8-bb6d-6bb9bd389bbd" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "に限る / とは限らない",
        base_meaning: "Nothing beats... (strong recommendation) vs. Not necessarily so (partial negation)",
        lesson_number: 7,
        sequence_order: 284,
        difficulty_level: "N3"
      },
      {
        id: "beeebc99-9c0b-4ef8-bb6d-6bb9bd389bbe" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "めったに〜ない",
        base_meaning: "Hardly ever / Seldom (crucial spoken frequency negation boundary)",
        lesson_number: 7,
        sequence_order: 285,
        difficulty_level: "N3"
      },
      {
        id: "bfeebc99-9c0b-4ef8-bb6d-6bb9bd389bbf" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "割に",
        base_meaning: "Considering... / Unexpectedly for... (expectation mismatch evaluator)",
        lesson_number: 7,
        sequence_order: 286,
        difficulty_level: "N3"
      },
      {
        id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd389bc0" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "Verb[volitional]とする",
        base_meaning: "Try to do / About to perform an action (spoken attempt/point aspect)",
        lesson_number: 7,
        sequence_order: 287,
        difficulty_level: "N3"
      },
      {
        id: "c1eebc99-9c0b-4ef8-bb6d-6bb9bd389bc1" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "そうもない",
        base_meaning: "Very unlikely to / Does not seem that (auditory negative speculation suffix)",
        lesson_number: 7,
        sequence_order: 288,
        difficulty_level: "N3"
      },
      {
        id: "c2eebc99-9c0b-4ef8-bb6d-6bb9bd389bc2" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ないことはない",
        base_meaning: "Not impossible / It's not that I can't (double negation cautious concession)",
        lesson_number: 7,
        sequence_order: 289,
        difficulty_level: "N3"
      },
      {
        id: "c3eebc99-9c0b-4ef8-bb6d-6bb9bd389bc3" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なんか・なんて",
        base_meaning: "Colloquial spoken filler / limit emphasis (like, kind of, things like)",
        lesson_number: 8,
        sequence_order: 290,
        difficulty_level: "N3"
      },
      {
        id: "c4eebc99-9c0b-4ef8-bb6d-6bb9bd389bc4" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ついでに",
        base_meaning: "Conversational action trigger (while you are at it / in passing)",
        lesson_number: 8,
        sequence_order: 291,
        difficulty_level: "N3"
      },
      {
        id: "c5eebc99-9c0b-4ef8-bb6d-6bb9bd389bc5" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "たとたんに",
        base_meaning: "Sudden aspect trigger (the instant / as soon as an action occurs)",
        lesson_number: 8,
        sequence_order: 292,
        difficulty_level: "N3"
      },
      {
        id: "c6eebc99-9c0b-4ef8-bb6d-6bb9bd389bc6" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "おきに / たびに",
        base_meaning: "Intermittent frequency vs. Absolute sequence (every other... vs. every time...)",
        lesson_number: 8,
        sequence_order: 293,
        difficulty_level: "N3"
      },
      {
        id: "c9eebc99-9c0b-4ef8-bb6d-6bb9bd389bc9" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "なし / あり",
        base_meaning: "Colloquial spoken suffixes indicating presence/absence (without / with, e.g. ari-enai)",
        lesson_number: 8,
        sequence_order: 296,
        difficulty_level: "N3"
      },
      {
        id: "daeebc99-9c0b-4ef8-bb6d-6bb9bd389bd0" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "考えられない",
        base_meaning: "Spoken reaction anchor (unthinkable / inconceivable)",
        lesson_number: 8,
        sequence_order: 297,
        difficulty_level: "N3"
      },
      {
        id: "dceebc99-9c0b-4ef8-bb6d-6bb9bd389bd2" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜向き / 〜向け",
        base_meaning: "Target indicators (suitable for vs. intentionally aimed at, e.g. kodomo-muke)",
        lesson_number: 9,
        sequence_order: 299,
        difficulty_level: "N3"
      },
      {
        id: "ddeebc99-9c0b-4ef8-bb6d-6bb9bd389bd3" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜切る / 〜きれない",
        base_meaning: "Action exhaustion suffixes (do completely to the end vs. unable to finish)",
        lesson_number: 9,
        sequence_order: 300,
        difficulty_level: "N3"
      },
      {
        id: "deeebc99-9c0b-4ef8-bb6d-6bb9bd389bd4" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜きり",
        base_meaning: "Spoken boundary limiter (only / just / since)",
        lesson_number: 9,
        sequence_order: 301,
        difficulty_level: "N3"
      },
      {
        id: "dfeebc99-9c0b-4ef8-bb6d-6bb9bd389bd5" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜かけ",
        base_meaning: "Unfinished state suffix (half-done / in the middle of)",
        lesson_number: 9,
        sequence_order: 302,
        difficulty_level: "N3"
      },
      {
        id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd389be0" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜たて",
        base_meaning: "Freshness action suffix (freshly done / just cooked, e.g. deki-tate)",
        lesson_number: 9,
        sequence_order: 303,
        difficulty_level: "N3"
      },
      {
        id: "e1eebc99-9c0b-4ef8-bb6d-6bb9bd389be1" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜込む",
        base_meaning: "Deepening/thorough action suffix (e.g. kangae-komu / tsure-komu)",
        lesson_number: 9,
        sequence_order: 304,
        difficulty_level: "N3"
      },
      {
        id: "e2eebc99-9c0b-4ef8-bb6d-6bb9bd389be2" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "ふりをする",
        base_meaning: "Pretended behavior (to pretend / act as if)",
        lesson_number: 9,
        sequence_order: 305,
        difficulty_level: "N3"
      },
      {
        id: "e3eebc99-9c0b-4ef8-bb6d-6bb9bd389be3" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "できれば (できたら)",
        base_meaning: "Conversational politeness softener (if possible)",
        lesson_number: 9,
        sequence_order: 306,
        difficulty_level: "N3"
      },
      {
        id: "e4eebc99-9c0b-4ef8-bb6d-6bb9bd389be4" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "でよければ",
        base_meaning: "Polite/friendly offer softener (if it's okay with you)",
        lesson_number: 9,
        sequence_order: 307,
        difficulty_level: "N3"
      },
      {
        id: "e5eebc99-9c0b-4ef8-bb6d-6bb9bd389be5" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "とおり",
        base_meaning: "Conformity/accuracy marker (exactly as / just as)",
        lesson_number: 9,
        sequence_order: 308,
        difficulty_level: "N3"
      },
      {
        id: "e6eebc99-9c0b-4ef8-bb6d-6bb9bd389be6" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "どうしても",
        base_meaning: "Emphatic spoken adverb (no matter what / regardless of)",
        lesson_number: 9,
        sequence_order: 309,
        difficulty_level: "N3"
      },
      {
        id: "e7eebc99-9c0b-4ef8-bb6d-6bb9bd389be7" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "同士",
        base_meaning: "Fellow / peers suffix (mutually / among each other, e.g. kodomo-doushi)",
        lesson_number: 9,
        sequence_order: 310,
        difficulty_level: "N3"
      },
      {
        id: "e8eebc99-9c0b-4ef8-bb6d-6bb9bd389be8" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "まさか",
        base_meaning: "Spoken shock/denial indicator (no way! / don't tell me!)",
        lesson_number: 10,
        sequence_order: 311,
        difficulty_level: "N3"
      },
      {
        id: "e9eebc99-9c0b-4ef8-bb6d-6bb9bd389be9" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "つい",
        base_meaning: "Accidental/regretful action (unconsciously / ended up doing)",
        lesson_number: 10,
        sequence_order: 312,
        difficulty_level: "N3"
      },
      {
        id: "eaeebc99-9c0b-4ef8-bb6d-6bb9bd389bea" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "せいで",
        base_meaning: "Causality attribution blame marker (because of [negative outcome])",
        lesson_number: 10,
        sequence_order: 313,
        difficulty_level: "N3"
      },
      {
        id: "ebeebc99-9c0b-4ef8-bb6d-6bb9bd389beb" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "くせに",
        base_meaning: "Spiteful/teasing concessive connector (even though / despite)",
        lesson_number: 10,
        sequence_order: 314,
        difficulty_level: "N3"
      },
      {
        id: "eceebc99-9c0b-4ef8-bb6d-6bb9bd389bec" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜がち / 〜ぎみ",
        base_meaning: "Negative tendency (prone to) vs. Slight physical/mental sensation (feeling slightly)",
        lesson_number: 10,
        sequence_order: 315,
        difficulty_level: "N3"
      },
      {
        id: "edeebc99-9c0b-4ef8-bb6d-6bb9bd389bed" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜っぽい",
        base_meaning: "Colloquial slang descriptive suffix (-ish / -like, e.g. kodomo-ppoi)",
        lesson_number: 10,
        sequence_order: 316,
        difficulty_level: "N3"
      },
      {
        id: "eeeebc99-9c0b-4ef8-bb6d-6bb9bd389bee" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "〜っぱなし",
        base_meaning: "Careless action evaluation (leaving as is / keeping on doing, e.g. terbi tsuke-ppanashi)",
        lesson_number: 10,
        sequence_order: 317,
        difficulty_level: "N3"
      },
      {
        id: "efeebc99-9c0b-4ef8-bb6d-6bb9bd389bef" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "わざわざ",
        base_meaning: "Appreciation/effort adverb (go out of one's way / take the trouble to)",
        lesson_number: 10,
        sequence_order: 318,
        difficulty_level: "N3"
      },
      {
        id: "f0eebc99-9c0b-4ef8-bb6d-6bb9bd389bf0" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "一体",
        base_meaning: "Spoken emphasis query modifier (what on earth? / what the heck?)",
        lesson_number: 10,
        sequence_order: 319,
        difficulty_level: "N3"
      },
      {
        id: "f1eebc99-9c0b-4ef8-bb6d-6bb9bd389bf1" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "折角",
        base_meaning: "Opportunity/effort appreciation marker (at great pains / precious occasion)",
        lesson_number: 10,
        sequence_order: 320,
        difficulty_level: "N3"
      },
      {
        id: "f2eebc99-9c0b-4ef8-bb6d-6bb9bd389bf2" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "っけ",
        base_meaning: "Spoken conversational recollection marker (what was it again?)",
        lesson_number: 10,
        sequence_order: 321,
        difficulty_level: "N3"
      },
      {
        id: "f3eebc99-9c0b-4ef8-bb6d-6bb9bd389bf3" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "代わりに",
        base_meaning: "Exchange / alternative connector (instead of / in place of)",
        lesson_number: 10,
        sequence_order: 322,
        difficulty_level: "N3"
      },
      {
        id: "f4eebc99-9c0b-4ef8-bb6d-6bb9bd389bf4" as GrammarPointId,
        deck_id: sampleDeckId,
        formal_name: "どころか",
        base_meaning: "Conversational correction/negation connector (far from / anything but)",
        lesson_number: 10,
        sequence_order: 323,
        difficulty_level: "N3"
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
    const srsCardsToSeed = grammarPoints.slice(0, 10).map((gp, index) => {
      const hexIndex = index.toString(16).padStart(4, '0');
      return {
        id: `d0eebc99-9c0b-4ef8-bb6d-6bb9bd38${hexIndex}` as SrsCardId,
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

if (import.meta.main) {
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
}
