type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [];

export const test = (name: string, run: TestCase['run']) => {
  tests.push({ name, run });
};

export const run = async () => {
  const started = Date.now();
  let passed = 0;
  const failures: Array<{ name: string; error: unknown }> = [];

  for (const item of tests) {
    try {
      await item.run();
      passed += 1;
      console.log(`ok ${passed} - ${item.name}`);
    } catch (error) {
      failures.push({ name: item.name, error });
      console.error(`not ok ${passed + failures.length} - ${item.name}`);
      console.error(error);
    }
  }

  console.log('');
  console.log(`tests ${tests.length}`);
  console.log(`pass ${passed}`);
  console.log(`fail ${failures.length}`);
  console.log(`duration_ms ${Date.now() - started}`);

  if (failures.length) {
    process.exitCode = 1;
  }
};
