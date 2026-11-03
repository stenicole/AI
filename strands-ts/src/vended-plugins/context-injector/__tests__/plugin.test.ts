import { describe, it, expect, vi } from 'vitest'
import { ContextInjector } from '../plugin.js'
import { TextBlock } from '../../../types/messages.js'
import { BeforeModelCallEvent } from '../../../hooks/events.js'
import { createMockAgent } from '../../../__fixtures__/agent-helpers.js'
import { Agent } from '../../../agent/agent.js'
import { MockMessageModel } from '../../../__fixtures__/mock-message-model.js'
import { SlidingWindowConversationManager } from '../../../conversation-manager/sliding-window-conversation-manager.js'
import type { StreamOptions } from '../../../models/model.js'
import type { ContentBlock } from '../../../types/messages.js'

describe('ContextInjector', () => {
  describe('plugin interface', () => {
    it('defaults to the strands:context-injector name', () => {
      expect(new ContextInjector({ renderContent: async () => 'x' }).name).toBe('strands:context-injector')
    })

    it('honors a custom name (so multiple injectors can be told apart)', () => {
      expect(new ContextInjector({ name: 'now', renderContent: async () => 'x' }).name).toBe('now')
    })

    it('registers a BeforeModelCallEvent hook on initAgent', () => {
      const agent = createMockAgent()
      new ContextInjector({ renderContent: async () => 'x' }).initAgent(agent)

      expect(agent.trackedHooks.map((hook) => hook.eventType)).toStrictEqual([BeforeModelCallEvent])
    })
  })

  describe('with an agent', () => {
    it('writes renderContent() text into the prompt, marked injected under its name', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({
        model,
        printer: false,
        plugins: [new ContextInjector({ name: 'weather', renderContent: async () => '<ctx>INJECTED</ctx>' })],
      })

      await agent.invoke('what is the weather?')

      expect(agent.messages[0]!.content).toStrictEqual([
        new TextBlock('what is the weather?'),
        new TextBlock('\n\n<ctx>INJECTED</ctx>', { metadata: { injected: { source: 'weather' } } }),
      ])
    })

    it('writes its text once, and again after a conversation manager removes the block', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'one' })
        .addTurn({ type: 'textBlock', text: 'two' })
        .addTurn({ type: 'textBlock', text: 'three' })
      const agent = new Agent({
        model,
        printer: false,
        conversationManager: new SlidingWindowConversationManager({ windowSize: 2 }),
        plugins: [new ContextInjector({ name: 'env', renderContent: async () => 'cwd: /repo' })],
      })
      const envBlock = new TextBlock('\n\ncwd: /repo', { metadata: { injected: { source: 'env' } } })

      await agent.invoke('first')
      expect(agent.messages[0]!.content).toStrictEqual([new TextBlock('first'), envBlock])

      // The text is unchanged, so nothing is written; the window then drops the first turn with its block.
      await agent.invoke('second')
      expect(agent.messages.map((message) => message.content)).toStrictEqual([
        [new TextBlock('second')],
        [new TextBlock('two')],
      ])

      await agent.invoke('third')
      expect(agent.messages[0]!.content).toStrictEqual([new TextBlock('third'), envBlock])
    })

    it('sends the injected block last and leaves the cache point on it, since the text no longer changes', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const seen: { lastBlock: ContentBlock | undefined; dynamicTrailingBlocks: number }[] = []
      const original = model.stream.bind(model)
      vi.spyOn(model, 'stream').mockImplementation(async function* (messages, options?: StreamOptions) {
        seen.push({
          lastBlock: messages.at(-1)?.content.at(-1),
          dynamicTrailingBlocks: options?.dynamicTrailingBlocks ?? 0,
        })
        yield* original(messages, options)
      })
      const agent = new Agent({
        model,
        printer: false,
        plugins: [new ContextInjector({ renderContent: async () => '<ctx>INJECTED</ctx>' })],
      })

      await agent.invoke('what is the weather?')

      expect(seen).toStrictEqual([
        {
          lastBlock: new TextBlock('\n\n<ctx>INJECTED</ctx>', {
            metadata: { injected: { source: 'strands:context-injector' } },
          }),
          dynamicTrailingBlocks: 0,
        },
      ])
    })
  })
})
