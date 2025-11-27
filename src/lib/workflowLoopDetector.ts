import logger from './logger';

interface NodeVisit {
  nodeId: string;
  timestamp: number;
  count: number;
}

export class WorkflowLoopDetector {
  private visits: Map<string, NodeVisit>;
  private maxVisitsPerNode: number;
  private maxTotalNodes: number;
  private startTime: number;
  private maxExecutionTime: number;

  constructor(options?: {
    maxVisitsPerNode?: number;
    maxTotalNodes?: number;
    maxExecutionTimeMs?: number;
  }) {
    this.visits = new Map();
    this.maxVisitsPerNode = options?.maxVisitsPerNode ?? 10;
    this.maxTotalNodes = options?.maxTotalNodes ?? 100;
    this.maxExecutionTime = options?.maxExecutionTimeMs ?? 300000; // 5 minutes
    this.startTime = Date.now();
  }

  /**
   * Record a node visit and check for loops
   * Throws error if loop detected
   */
  visitNode(nodeId: string): void {
    // Check execution time limit
    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.maxExecutionTime) {
      logger.error('Workflow execution timeout', {
        nodeId,
        elapsed,
        maxTime: this.maxExecutionTime,
      });
      throw new WorkflowLoopError(
        `Workflow execution timeout: exceeded ${this.maxExecutionTime}ms`
      );
    }

    // Check total nodes visited
    if (this.visits.size >= this.maxTotalNodes) {
      logger.error('Workflow node limit exceeded', {
        nodeId,
        nodesVisited: this.visits.size,
        maxNodes: this.maxTotalNodes,
      });
      throw new WorkflowLoopError(
        `Workflow node limit exceeded: visited ${this.visits.size} nodes`
      );
    }

    // Track or update node visit
    const existing = this.visits.get(nodeId);
    
    if (existing) {
      existing.count++;
      existing.timestamp = Date.now();

      // Check if same node visited too many times (loop detected)
      if (existing.count > this.maxVisitsPerNode) {
        logger.error('Workflow infinite loop detected', {
          nodeId,
          visits: existing.count,
          maxVisits: this.maxVisitsPerNode,
        });
        throw new WorkflowLoopError(
          `Infinite loop detected: node "${nodeId}" visited ${existing.count} times`
        );
      }

      this.visits.set(nodeId, existing);
    } else {
      this.visits.set(nodeId, {
        nodeId,
        timestamp: Date.now(),
        count: 1,
      });
    }
  }

  /**
   * Get execution statistics
   */
  getStats() {
    return {
      nodesVisited: this.visits.size,
      maxNodes: this.maxTotalNodes,
      executionTime: Date.now() - this.startTime,
      maxExecutionTime: this.maxExecutionTime,
      visitedNodes: Array.from(this.visits.values()).map(v => ({
        nodeId: v.nodeId,
        visitCount: v.count,
      })),
    };
  }

  /**
   * Check if execution is approaching limits (for warnings)
   */
  isApproachingLimit(): { warning: boolean; message?: string } {
    const nodesWarning = this.visits.size > this.maxTotalNodes * 0.8;
    const timeWarning = 
      (Date.now() - this.startTime) > this.maxExecutionTime * 0.8;

    if (nodesWarning) {
      return {
        warning: true,
        message: `Approaching node limit: ${this.visits.size}/${this.maxTotalNodes} nodes visited`,
      };
    }

    if (timeWarning) {
      const elapsed = Date.now() - this.startTime;
      return {
        warning: true,
        message: `Approaching time limit: ${elapsed}ms/${this.maxExecutionTime}ms elapsed`,
      };
    }

    return { warning: false };
  }

  /**
   * Reset detector (for testing or restarting workflow)
   */
  reset(): void {
    this.visits.clear();
    this.startTime = Date.now();
  }
}

export class WorkflowLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowLoopError';
  }
}
