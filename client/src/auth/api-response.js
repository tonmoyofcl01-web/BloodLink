function responseLabel(response) {
  return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
}

/** Read an expected JSON response without turning empty or proxy error pages into JSON parse errors. */
export async function readApiJson(response) {
  const body = await response.text();
  const label = responseLabel(response);
  if (!body.trim()) {
    throw new Error(`BloodLink returned an empty response (${label}). Check the API server output for the cause.`);
  }

  try {
    const data = JSON.parse(body);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('The response was not a JSON object.');
    return data;
  } catch (error) {
    if (error.message === 'The response was not a JSON object.') {
      throw new Error(`BloodLink returned an unexpected response (${label}): ${error.message}`);
    }
    const detail = body.trim().replace(/\s+/gu, ' ').slice(0, 240);
    throw new Error(`BloodLink returned invalid JSON (${label}). Response: ${detail}`);
  }
}

export function authRequestError(error, action) {
  if (error instanceof TypeError) {
    return `The ${action} request could not reach the BloodLink API (${error.message}). Check that the API server is running and review its terminal output.`;
  }
  return error?.message || `The ${action} request failed.`;
}
