import { BeforeModelCallEvent } from '../hooks/events.js'
import { HookOrder } from '../hooks/types.js'
import { Message, TextBlock } from '../types/messages.js'
import type { ContentBlock, MessageData } from '../types/messages.js'
import type { LocalAgent } from '../types/agent.js'
import { logger } from '../logging/logger.js'
import { normalizeError } from '../errors.js'
import type { InjectionOptions, InjectionTrigger, InjectionContext } from './types.js'

/**
 * Writes {@link InjectionOptions.renderContent}'s text into the latest user message before each model
 * call, as a {@link TextBlock} marked with `metadata.injected`, and leaves it there.
 *
 * The write happens in a `BeforeModelCallEvent` hook that runs after the SDK's other hooks, so it reaches
 * that model call and lands in any user message those hooks added. It only ever touches the latest message
 * while it is a user message, which the model has not answered yet. Every later request therefore starts
 * with the earlier one unchanged.
 *
 * No event fires for the write. Listeners that see messages as they are added (the session manager, the
 * context manager's stash, memory extraction) heard this message before the text was written, and a session
 * saves the whole conversation, so it picks the text up at its next save.
 *
 * An injection writes into a message at most once, so a retry, a forced structured output call or a resume
 * sends the same request again. Across turns, text equal to the last text its source wrote is not written
 * again while that block is still in the conversation. Both checks read the conversation itself, so they hold
 * after a session restore. Anything that skips — a cancelled call, the trigger not firing, `renderContent`
 * returning empty, or any callback throwing — leaves the conversation unchanged so the model call proceeds
 * (fail open).
 *
 * @param agent - The agent to inject into
 * @param opts - The source name, trigger and `renderContent` callback
 * @internal Delivery primitive. Reach injection through `ContextInjector` or `MemoryManager`.
 */
export function addInjection(agent: LocalAgent, opts: InjectionOptions): void {
  const trigger = resolveTrigger(opts.trigger)

  agent.addHook(
    BeforeModelCallEvent,
    async (event) => {
      const messages = event.agent.messages
      const latest = messages.at(-1)
      if (event.cancel || !latest || latest.role !== 'user') {
        return
      }
      // A retry, forced structured output call or resume re-enters a message this injection already wrote into.
      if (latest.content.some((block) => isInjectedBy(block, opts.source))) {
        return
      }

      const injectionContext: InjectionContext = {
        messages: messages.map((message) => message.toJSON()),
        appState: event.agent.appState,
        agent: event.agent,
      }
      if (!trigger(injectionContext)) {
        return
      }

      let rendered: string | undefined
      try {
        rendered = await opts.renderContent(injectionContext)
      } catch (error) {
        logger.warn(`reason=<${normalizeError(error).message}> | injection renderContent threw; skipping injection`)
        return
      }
      if (!rendered?.trim()) {
        return
      }

      // Some providers join adjacent text blocks, which would run this onto the content before it.
      const text = latest.content.length > 0 && !rendered.startsWith('\n') ? `\n\n${rendered}` : rendered
      if (text === lastInjectedText(messages, opts.source)) {
        return
      }

      messages[messages.length - 1] = new Message({
        role: 'user',
        content: [...latest.content, new TextBlock(text, { metadata: { injected: { source: opts.source } } })],
        trackingId: latest.trackingId,
        ...(latest.metadata !== undefined && { metadata: latest.metadata }),
      })
    },
    { order: HookOrder.SDK_LAST }
  )
}

/**
 * Resolves an {@link InjectionTrigger} name or predicate into a single gate predicate over the
 * {@link InjectionContext}.
 *
 * `'userTurn'` maps to {@link isUserTurn} (over `ctx.messages`); `'everyTurn'` to an always-true gate;
 * a user-supplied predicate is wrapped so that a throw fails open (logs and skips injection rather than
 * aborting the model call).
 *
 * @param trigger - An {@link InjectionTrigger} name, a predicate, or `undefined` (defaults to `'userTurn'`)
 * @returns A predicate that, given the {@link InjectionContext}, returns whether to inject this call
 * @internal Delivery primitive. Reach injection through `ContextInjector` or `MemoryManager`.
 */
export function resolveTrigger(
  trigger: InjectionTrigger | ((context: InjectionContext) => boolean) | undefined
): (context: InjectionContext) => boolean {
  if (trigger === undefined || trigger === 'userTurn') {
    return (context) => isUserTurn(context.messages)
  }
  if (trigger === 'everyTurn') {
    return () => true
  }
  const predicate = trigger
  return (context) => {
    try {
      return predicate(context)
    } catch (error) {
      logger.warn(`reason=<${normalizeError(error).message}> | injection trigger threw; skipping injection`)
      return false
    }
  }
}

/**
 * Whether the latest message is a fresh user ask: a `user` message carrying no tool result. This is
 * the `'userTurn'` policy — it distinguishes a new chat ask from an autonomous tool-result turn.
 *
 * @param messages - The current conversation, as data
 * @returns `true` when the latest message is a plain user ask, otherwise `false`
 * @internal Delivery primitive. Reach injection through `ContextInjector` or `MemoryManager`.
 */
export function isUserTurn(messages: MessageData[]): boolean {
  const last = messages[messages.length - 1]
  return !!last && last.role === 'user' && !last.content.some((block) => 'toolResult' in block)
}

function isInjectedBy(block: ContentBlock, source: string): block is TextBlock {
  return block.type === 'textBlock' && block.metadata?.injected?.source === source
}

/** Text of the latest block `source` injected that is still in the conversation. */
function lastInjectedText(messages: readonly Message[], source: string): string | undefined {
  return messages.flatMap((message) => message.content.filter((block) => isInjectedBy(block, source))).at(-1)?.text
}
