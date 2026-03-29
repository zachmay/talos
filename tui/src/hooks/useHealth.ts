import { useState, useEffect } from "react";
import { exec } from "node:child_process";
import type { HealthStatus } from "../../../shared/types.js";

export function useHealth() {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    const poll = () => {
      exec("./talos health --json", (error, stdout) => {
        if (error) {
          setHealth(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as HealthStatus;
          setHealth(parsed);
        } catch {
          setHealth(null);
        }
      });
    };

    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, []);

  return { health };
}
