// Calls to the bank API and to ThunderID's flow execution API, both through the dev server proxy.
import { config } from './config.js';

async function bank(session, method, path, body) {
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description ?? data.error ?? `Request failed (${response.status})`);
  }
  return data;
}

export const getAccount = (session) => bank(session, 'GET', '/api/account');
export const makeTransfer = (session, transfer) => bank(session, 'POST', '/api/transfer', transfer);

// flowError reads an error from a flow response, whose messages are i18n objects with a default value.
function flowError(error, fallback) {
  const text = (message) => (typeof message === 'string' ? message : message?.defaultValue);
  return error ? `${text(error.message) ?? error.code}: ${text(error.description) ?? ''}` : fallback;
}

async function flowStep(session, payload) {
  const response = await fetch('/flow/execute', {
    method: 'POST',
    // The signed-in user's token makes them the owner of the agent the flow creates.
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(flowError(data, `Registration failed (${response.status})`));
  }
  if (data.flowStatus === 'ERROR') {
    throw new Error(flowError(data.error, 'Registration failed'));
  }
  return data;
}

// The registration flow asks for what the agent type's schema needs plus the redirect URI and an
// optional key, so the portal renders whatever inputs a step returns. It shows them in the order an owner
// reads them: the agent's name and description first, then where it signs in from and its key.
const INPUT_ORDER = ['name', 'modelProvider', 'model', 'function'];
const LAST_INPUTS = ['redirectUris', 'jwksUri', 'publicKey'];
function inputRank(input) {
  const first = INPUT_ORDER.indexOf(input.identifier);
  const last = LAST_INPUTS.indexOf(input.identifier);
  return first >= 0 ? first : last >= 0 ? 100 + last : 50;
}

function toStep(data) {
  return {
    executionId: data.executionId,
    challengeToken: data.challengeToken,
    inputs: [...(data.data?.inputs ?? [])].sort((a, b) => inputRank(a) - inputRank(b)),
    actions: (data.data?.actions ?? []).map((action) => action.ref),
    action: data.data?.actions?.[0]?.ref ?? '',
  };
}

// The registration flow opens with a choice between creating an account and registering a personal
// assistant, then asks for the agent kind. The signed-in owner is here to register an assistant, so
// the portal answers both.
const PERSONAL_ASSISTANT_ACTION = 'action_register_personal_agent';
const AGENT_KIND = { identifier: 'kind', value: 'personal-assistant' };

async function execute(session, step, action, inputs) {
  const data = await flowStep(session, {
    executionId: step.executionId,
    challengeToken: step.challengeToken,
    action,
    inputs,
  });
  return data;
}

// answerKnownSteps moves past the steps the portal answers itself, and returns the first step that
// needs the owner, or the completed flow.
async function answerKnownSteps(session, data) {
  let current = data;
  for (let i = 0; i < 5 && current.flowStatus !== 'COMPLETE'; i += 1) {
    const step = toStep(current);
    if (step.actions.includes(PERSONAL_ASSISTANT_ACTION)) {
      current = await execute(session, step, PERSONAL_ASSISTANT_ACTION);
    } else if (step.inputs.length === 1 && step.inputs[0].identifier === AGENT_KIND.identifier) {
      current = await execute(session, step, step.action, { [AGENT_KIND.identifier]: AGENT_KIND.value });
    } else {
      break;
    }
  }
  return current;
}

function agentFrom(data) {
  const extra = data.data?.additionalData ?? {};
  return { agentId: extra.agentId, clientId: extra.clientId, clientSecret: extra.clientSecret };
}

// startRegistration starts the portal's registration flow as the signed-in user, takes the personal
// assistant branch, and returns the first step that asks the owner for something.
export async function startRegistration(session) {
  const data = await flowStep(session, {
    applicationId: config.applicationId,
    flowType: 'REGISTRATION',
  });
  const next = await answerKnownSteps(session, data);
  return next.flowStatus === 'COMPLETE' ? { agent: agentFrom(next) } : { step: toStep(next) };
}

// submitRegistration sends the values for a step. It returns { agent } once the agent is created, or
// { step } when the flow asks for more, with the error that sent it back if there was one.
export async function submitRegistration(session, step, values) {
  const inputs = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v != null));
  const data = await answerKnownSteps(session, await execute(session, step, step.action, inputs));
  if (data.flowStatus === 'COMPLETE') {
    return { agent: agentFrom(data) };
  }
  return { step: toStep(data), error: data.error ? flowError(data.error) : '' };
}

// The optional attributes of ThunderID's default agent type (its bootstrap 01-default-resources.yaml), which
// the assistant fills in about itself. The registration form shows them as fields.
const AGENT_ATTRIBUTE_FLAGS = `   --model-provider <one of: openai, anthropic, gemini, mistral, custom>
   --model <the model you run on>
   --function <one of: task-automation, rag-retrieval, code-gen, data-analysis, orchestrator, sub-agent, assistant, custom>`;

// How the assistant describes its access. It has its own identity and token and acts for the owner; the owner
// signs in only to approve it.
const ACCESS_WORDING = 'The access you get is your own, to act on my behalf. Never say that you sign in to my account or log in as me.';

// connectPromptText is the message the owner pastes into Claude Code to have it register itself. The
// assistant names and describes itself, and shows the owner what it registers with before it does: the toolkit
// starts ThunderID's registration flow, and the bank emails the owner a link to ThunderID's pages, where they
// approve and are shown the assistant identifier to paste back. The assistant speaks as itself afterwards: it
// is the one registered.
export function connectPromptText(user) {
  const origin = window.location.origin;
  const owner = user?.givenName ?? user?.username;
  const ownerName = owner ? `${owner}'s` : 'My';
  const ownerEmail = user?.email ?? '<my email at the bank>';
  return `Set up my Sample Bank assistant. You will be my assistant at the Sample Bank, so you can check my balance and make transfers for me. Do these steps in order. Ask me only to approve the details you register with, and wait for me to paste the assistant identifier the bank shows me.

1. Install the bank's agent toolkit and its skill:

   mkdir -p ~/.sample-bank ~/.claude/skills/bank-assistant
   curl -fsSL ${origin}/agent/bank-agent.mjs -o ~/.sample-bank/bank-agent.mjs
   curl -fsSL ${origin}/agent/SKILL.md -o ~/.claude/skills/bank-assistant/SKILL.md

2. Read ~/.claude/skills/bank-assistant/SKILL.md and follow it from now on, in this conversation and whenever I ask about my bank account. Do not get access to the bank yet: wait until I first ask you to do something there.

3. Register yourself as my assistant with this command:

   node ~/.sample-bank/bank-agent.mjs register --owner-email ${ownerEmail} --name "${ownerName} <your name>" <flags that describe you>

   For the name, use your own product name, for example "${ownerName} Claude Code". Describe yourself with these flags, and leave out any you are not sure of:

${AGENT_ATTRIBUTE_FLAGS}

   Before you run it, show me everything it will submit and wait for my approval, as the skill says. Once I approve, run it. It returns once the bank has emailed me a link to approve your registration. Then tell me that the bank sent me an email: I open it, click Sign in, approve your registration, and paste here the assistant identifier the bank's page then shows. Wait for it.

4. When I paste the assistant identifier, run:

   node ~/.sample-bank/bank-agent.mjs finish-registration --assistant-identifier <the assistant identifier I pasted>

5. Reply as yourself, my assistant, in two short sentences: say that you are now registered as my assistant at the Sample Bank, and that I can ask you things like my balance, my recent transactions, or making a transfer.

${ACCESS_WORDING}
`;
}

// setupTextFor is the message the owner pastes into Claude Code. It has the agent download the bank's
// toolkit and skill, get its access to act for the owner, and keep following the skill.
export function setupTextFor(agent) {
  const origin = window.location.origin;
  return `Set up my Sample Bank assistant. I registered you with the Sample Bank as my assistant "${agent.name}", so you can check my balance and make transfers for me. Do these steps without asking me anything, then reply in one or two short sentences.

1. Install the bank's agent toolkit and its skill:

   mkdir -p ~/.sample-bank ~/.claude/skills/bank-assistant
   curl -fsSL ${origin}/agent/bank-agent.mjs -o ~/.sample-bank/bank-agent.mjs
   curl -fsSL ${origin}/agent/SKILL.md -o ~/.claude/skills/bank-assistant/SKILL.md

2. Get your access to the bank. Tell me that a browser tab will open for me to sign in and approve what you may do for me, then run:

   node ~/.sample-bank/bank-agent.mjs login --assistant-identifier ${agent.clientId}

   It waits until I approve, for up to 5 minutes, so run it with a timeout of at least 5 minutes.

3. Read ~/.claude/skills/bank-assistant/SKILL.md and follow it whenever I ask about my bank account, starting in this conversation.

4. Reply as yourself, my assistant: say that you can now act for me at the bank, which permissions I approved, and that I can ask things like "What's my balance?"

${ACCESS_WORDING}
`;
}
