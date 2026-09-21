/**
 * @author Codex
 * @description Owns the ephemeral permission mode and evaluates permission requests independently of Pi transports.
 */

import { evaluatePermissionRequest } from './permission-evaluation.js';
import type { PermissionMode, PermissionStateDto, PermissionResolvedConfig } from '@octopus/shared/protocol';
import type {
  PermissionPolicyRepository,
  PermissionReviewLogger,
  PermissionReviewLogReader,
} from '../definitions/port.js';
import type {
  PermissionAuditConfig,
  PermissionPolicy,
  PermissionPolicyLoadResult,
  PermissionReviewEvent,
  PermissionReviewQuery,
  PermissionReviewQueryResult,
} from '../definitions/types.js';

export type PermissionDecision = 'allow' | 'ask' | 'deny';

export type PermissionDecisionSource =
  | 'configuration'
  | 'hard_safety'
  | 'static_policy'
  | 'session_approval'
  | 'read_default'
  | 'full_mode'
  | 'auto_tool'
  | 'auto_write'
  | 'default_ask';

export interface PermissionEvaluation {
  decision: PermissionDecision;
  source: PermissionDecisionSource;
}

export interface PermissionRequest {
  toolName: string;
  kind: 'read' | 'write' | 'shell' | 'custom';
  external: boolean;
  sensitive: boolean;
  sessionApprovalKey?: string;
}

/**
 * Maintains permission state for exactly one Agent process generation.
 */
export class PermissionModeService {
  private mode: PermissionMode = 'ask';
  private loadedScope?: string;
  private configurationInvalid = false;
  private readonly sessionApprovals = new Set<string>();

  /**
   * Creates one runtime-generation service with an injected configuration boundary.
   *
   * @param policyRepository Repository used when Pi starts or reloads a session.
   * @param policy Initial policy loaded before Pi emits lifecycle events.
   */
  public constructor(
    private readonly policyRepository: PermissionPolicyRepository,
    private readonly reviewLogger: PermissionReviewLogger,
    private readonly reviewLogReader: PermissionReviewLogReader,
    private policy: PermissionPolicy,
    private auditConfig: PermissionAuditConfig,
    private configuration: PermissionResolvedConfig
  ) {}

  /**
   * Returns the authoritative runtime-generation state.
   *
   * @returns Current non-persisted permission state.
   */
  public getState(): PermissionStateDto {
    return { mode: this.mode, scope: 'runtime-generation', persisted: false };
  }

  /**
   * Changes the effective permission mode for subsequent operations.
   *
   * @param mode Requested permission mode.
   * @returns Updated authoritative state.
   */
  public setMode(mode: PermissionMode): PermissionStateDto {
    this.mode = mode;
    return this.getState();
  }

  /**
   * Refreshes global and trusted-project policy for the active Pi workspace.
   *
   * @param cwd Active workspace directory.
   * @param projectTrusted Whether project configuration may participate.
   * @returns Effective policy and configuration diagnostics.
   */
  public reloadPolicy(cwd: string, projectTrusted: boolean): PermissionPolicyLoadResult {
    const scope = JSON.stringify([cwd, projectTrusted]);
    try {
      const result = this.policyRepository.load(cwd, projectTrusted);
      if (
        this.loadedScope !== scope ||
        JSON.stringify(result.configuration) !== JSON.stringify(this.configuration)
      ) {
        this.clearSessionApprovals();
      }
      this.loadedScope = scope;
      this.configurationInvalid = false;
      this.policy = result.policy;
      this.auditConfig = result.audit;
      this.configuration = result.configuration;
      return result;
    } catch (error) {
      this.configurationInvalid = true;
      this.clearSessionApprovals();
      return {
        configuration: this.configuration,
        policy: this.policy,
        audit: this.auditConfig,
        diagnostics: [
          {
            path: error instanceof Error && 'path' in error ? String(error.path) : cwd,
            message: error instanceof Error ? error.message : 'Invalid permission configuration.',
          },
        ],
      };
    }
  }

  /**
   * Return a detached rule snapshot for request normalization.
   */
  public getConfiguration(): PermissionResolvedConfig {
    return structuredClone(this.configuration);
  }

  /**
   * Writes one durable permission review event when auditing is enabled.
   *
   * @param event Stable review event name.
   * @param details Structured request and decision facts.
   * @returns A deduplicated persistence warning when the write failed.
   */
  public writeReviewLog(
    event: PermissionReviewEvent,
    details: Readonly<Record<string, unknown>>
  ): string | undefined {
    if (!this.auditConfig.permissionReviewLog) {
      return undefined;
    }
    return this.reviewLogger.write(event, details, this.auditConfig.reviewLogFieldMaxWidth);
  }

  /**
   * Reads the newest matching permission review events through the controlled audit boundary.
   *
   * @param query Exact filters and a result limit from 1 through 100.
   * @param signal Optional cancellation signal from Pi.
   * @returns Bounded structured review entries in chronological order.
   * @throws RangeError when the requested limit is outside the public contract.
   * @throws TypeError when the since timestamp is invalid.
   */
  public async queryReviewLog(
    query: PermissionReviewQuery,
    signal?: AbortSignal
  ): Promise<PermissionReviewQueryResult> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new RangeError('Permission audit query limit must be an integer from 1 through 100.');
    }
    if (query.since !== undefined && Number.isNaN(Date.parse(query.since))) {
      throw new TypeError('Permission audit query since must be a valid ISO-8601 timestamp.');
    }
    return this.reviewLogReader.query(query, signal);
  }

  /**
   * Allows later requests in the same Pi session to reuse an explicitly granted scope.
   *
   * @param key Stable scope derived from the approved operation.
   */
  public recordSessionApproval(key: string): void {
    this.sessionApprovals.add(key);
  }

  /**
   * Clears ephemeral approvals when Pi closes the owning session.
   */
  public clearSessionApprovals(): void {
    this.sessionApprovals.clear();
  }

  /**
   * Evaluates one operation while preserving hard safety boundaries.
   *
   * @param request Normalized operation characteristics.
   * @returns Whether the operation can run, needs confirmation, or is denied.
   */
  public decide(request: PermissionRequest): PermissionDecision {
    return this.evaluate(request).decision;
  }

  /**
   * Evaluates one operation and identifies the rule family that made the decision.
   *
   * @param request Normalized operation characteristics.
   * @returns Decision and auditable provenance.
   */
  public evaluate(request: PermissionRequest): PermissionEvaluation {
    return evaluatePermissionRequest(
      request,
      this.configuration,
      this.policy,
      this.mode,
      request.sessionApprovalKey !== undefined && this.sessionApprovals.has(request.sessionApprovalKey),
      this.configurationInvalid
    );
  }
}
