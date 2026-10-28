// One budget for the entire operation, including response-body consumption.
export async function withRequestDeadline(timeoutMs, operation) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('Request deadline exceeded', 'TimeoutError');
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const wait = promise => Promise.race([promise, expired]);
  try {
    return await wait(operation(controller.signal, wait));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
