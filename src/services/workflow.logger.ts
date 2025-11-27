import { prisma } from "../lib/prisma";
import logger from '../lib/logger';
import { ExecutionLog } from "./workflow.types";
import { NodeType } from "@prisma/client";

/**
 * Workflow Execution Logger
 * Provides structured logging for workflow executions
 */

export class WorkflowLogger {
  private executionId: string;
  private logs: ExecutionLog[] = [];
  private nodeStartTimes: Map<string, number> = new Map();

  constructor(executionId: string) {
    this.executionId = executionId;
  }

  /**
   * Log when a node starts execution
   */
  async nodeStart(nodeId: string, nodeLabel: string, nodeType: NodeType, config?: any) {
    this.nodeStartTimes.set(nodeId, Date.now());
    
    const message = config?.displayMessage || `Starting: ${nodeLabel}`;
    
    await this.log({
      nodeId,
      nodeLabel,
      nodeType,
      level: 'info',
      message,
      data: { config: this.sanitizeConfig(config) }
    });

    logger.info(`[Workflow ${this.executionId}] ${message}`, {
      nodeId,
      nodeType,
    });
  }

  /**
   * Log when a node completes successfully
   */
  async nodeSuccess(
    nodeId: string,
    nodeLabel: string,
    nodeType: NodeType,
    result?: any,
    config?: any
  ) {
    const duration = this.calculateDuration(nodeId);
    const message = config?.successMessage || `Completed: ${nodeLabel}`;
    
    await this.log({
      nodeId,
      nodeLabel,
      nodeType,
      level: 'info',
      message,
      data: { result: this.sanitizeData(result) },
      duration
    });

    logger.info(`[Workflow ${this.executionId}] ${message}`, {
      nodeId,
      nodeType,
      duration: `${duration}ms`,
      result: this.sanitizeData(result)
    });
  }

  /**
   * Log when a node fails
   */
  async nodeError(
    nodeId: string,
    nodeLabel: string,
    nodeType: NodeType,
    error: Error | string,
    config?: any
  ) {
    const duration = this.calculateDuration(nodeId);
    const errorMessage = error instanceof Error ? error.message : error;
    const message = config?.errorMessage || `Failed: ${nodeLabel} - ${errorMessage}`;
    
    await this.log({
      nodeId,
      nodeLabel,
      nodeType,
      level: 'error',
      message,
      data: {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      },
      duration
    });

    logger.error(`[Workflow ${this.executionId}] ${message}`, {
      nodeId,
      nodeType,
      error: errorMessage,
      duration: `${duration}ms`
    });
  }

  /**
   * Log a warning
   */
  async warn(
    nodeId: string,
    nodeLabel: string,
    nodeType: NodeType,
    message: string,
    data?: any
  ) {
    await this.log({
      nodeId,
      nodeLabel,
      nodeType,
      level: 'warn',
      message,
      data: this.sanitizeData(data)
    });

    logger.warn(`[Workflow ${this.executionId}] ${message}`, {
      nodeId,
      nodeType,
      data: this.sanitizeData(data)
    });
  }

  /**
   * Log debug information
   */
  async debug(
    nodeId: string,
    nodeLabel: string,
    nodeType: NodeType,
    message: string,
    data?: any
  ) {
    await this.log({
      nodeId,
      nodeLabel,
      nodeType,
      level: 'debug',
      message,
      data: this.sanitizeData(data)
    });

    logger.debug(`[Workflow ${this.executionId}] ${message}`, {
      nodeId,
      nodeType,
      data: this.sanitizeData(data)
    });
  }

  /**
   * Log custom info message
   */
  async info(
    nodeId: string,
    nodeLabel: string,
    nodeType: NodeType,
    message: string,
    data?: any
  ) {
    await this.log({
      nodeId,
      nodeLabel,
      nodeType,
      level: 'info',
      message,
      data: this.sanitizeData(data)
    });

    logger.info(`[Workflow ${this.executionId}] ${message}`, {
      nodeId,
      nodeType,
      data: this.sanitizeData(data)
    });
  }

  /**
   * Log workflow execution start
   */
  async workflowStart(workflowId: string, workflowName: string, initialData?: any) {
    logger.info(`[Workflow ${this.executionId}] Starting workflow: ${workflowName}`, {
      workflowId,
      initialData: this.sanitizeData(initialData)
    });
  }

  /**
   * Log workflow execution completion
   */
  async workflowComplete(duration: number, result?: any) {
    logger.info(`[Workflow ${this.executionId}] Workflow completed successfully`, {
      duration: `${duration}ms`,
      result: this.sanitizeData(result)
    });
  }

  /**
   * Log workflow execution failure
   */
  async workflowFailed(error: Error | string, duration?: number) {
    const errorMessage = error instanceof Error ? error.message : error;
    logger.error(`[Workflow ${this.executionId}] Workflow failed`, {
      error: errorMessage,
      duration: duration ? `${duration}ms` : undefined,
      stack: error instanceof Error ? error.stack : undefined
    });
  }

  /**
   * Log variable update
   */
  async variableSet(
    nodeId: string,
    nodeLabel: string,
    nodeType: NodeType,
    variableName: string,
    value: any
  ) {
    await this.log({
      nodeId,
      nodeLabel,
      nodeType,
      level: 'debug',
      message: `Variable set: ${variableName}`,
      data: { variableName, value: this.sanitizeData(value) }
    });

    logger.debug(`[Workflow ${this.executionId}] Variable set: ${variableName}`, {
      nodeId,
      value: this.sanitizeData(value)
    });
  }

  /**
   * Log condition evaluation
   */
  async conditionEvaluated(
    nodeId: string,
    nodeLabel: string,
    nodeType: NodeType,
    result: boolean,
    condition?: any
  ) {
    await this.log({
      nodeId,
      nodeLabel,
      nodeType,
      level: 'info',
      message: `Condition evaluated: ${result ? 'TRUE' : 'FALSE'}`,
      data: { result, condition: this.sanitizeData(condition) }
    });

    logger.info(`[Workflow ${this.executionId}] Condition: ${result ? 'TRUE' : 'FALSE'}`, {
      nodeId,
      nodeLabel
    });
  }

  /**
   * Internal log method
   */
  private async log(logEntry: Omit<ExecutionLog, 'timestamp'>) {
    const fullLog: ExecutionLog = {
      ...logEntry,
      timestamp: new Date()
    };

    this.logs.push(fullLog);

    // Persist to database
    try {
      const execution = await prisma.workflowExecution.findUnique({
        where: { id: this.executionId }
      });

      if (execution) {
        const currentLogs = (execution.logs as any[]) || [];
        await prisma.workflowExecution.update({
          where: { id: this.executionId },
          data: {
            logs: [...currentLogs, fullLog]
          }
        });
      }
    } catch (error) {
      logger.error('Failed to persist workflow log', {
        executionId: this.executionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Calculate duration since node start
   */
  private calculateDuration(nodeId: string): number {
    const startTime = this.nodeStartTimes.get(nodeId);
    if (!startTime) return 0;
    return Date.now() - startTime;
  }

  /**
   * Sanitize sensitive data from logs
   */
  private sanitizeData(data: any): any {
    if (!data) return data;
    
    const sensitiveKeys = [
      'password',
      'token',
      'apiKey',
      'secret',
      'authorization',
      'api_key',
      'access_token',
      'refresh_token'
    ];

    if (typeof data === 'object') {
      const sanitized = { ...data };
      
      for (const key of Object.keys(sanitized)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
          sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'object') {
          sanitized[key] = this.sanitizeData(sanitized[key]);
        }
      }
      
      return sanitized;
    }
    
    return data;
  }

  /**
   * Sanitize config before logging
   */
  private sanitizeConfig(config: any): any {
    if (!config) return config;
    
    const sanitized = this.sanitizeData(config);
    
    // Remove potentially large fields
    if (sanitized.body && typeof sanitized.body === 'string' && sanitized.body.length > 1000) {
      sanitized.body = sanitized.body.substring(0, 1000) + '... [truncated]';
    }
    
    return sanitized;
  }

  /**
   * Get all logs for this execution
   */
  getLogs(): ExecutionLog[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: ExecutionLog['level']): ExecutionLog[] {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Get logs for a specific node
   */
  getLogsByNode(nodeId: string): ExecutionLog[] {
    return this.logs.filter(log => log.nodeId === nodeId);
  }

  /**
   * Check if there were any errors
   */
  hasErrors(): boolean {
    return this.logs.some(log => log.level === 'error');
  }

  /**
   * Get total execution time for a node
   */
  getNodeDuration(nodeId: string): number {
    const nodeLogs = this.getLogsByNode(nodeId);
    const durations = nodeLogs.map(log => log.duration || 0);
    return durations.reduce((sum, d) => sum + d, 0);
  }
}
