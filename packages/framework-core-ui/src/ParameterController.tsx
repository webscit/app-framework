import { useCallback, useEffect, useRef, useState } from "react";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Slider } from "./components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { usePublish } from "./usePublish";
import "./ParameterController.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParameterType = "string" | "number";
export type ParameterWidget = "slider" | "input" | "select";

export interface ParameterConfig {
  /** Display label shown above the control. */
  title: string;
  /** JSON schema type. */
  type: ParameterType;
  /** Default value applied on mount. */
  default: number | string;
  /** Minimum value — for slider and number input. */
  minimum?: number;
  /** Maximum value — for slider and number input. */
  maximum?: number;
  /** Step increment — for slider and number input. */
  multipleOf?: number;
  /** Options list — for select. */
  enum?: string[];
  /** Widget rendering options. */
  "x-options"?: {
    widget?: ParameterWidget;
  };
}

export interface ParameterControllerProps {
  /**
   * EventBus channel to publish parameter updates to.
   * Default: "params/control"
   */
  channel?: string;
  /**
   * Parameter definitions keyed by parameter name.
   * The key is used as the field name in the published payload.
   */
  parameters?: Record<string, ParameterConfig>;
  /**
   * Debounce delay in milliseconds for slider controls.
   * Default: 300
   */
  debounceMs?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveWidget(config: ParameterConfig): ParameterWidget {
  const explicit = config["x-options"]?.widget;
  if (explicit) return explicit;
  if (config.enum) return "select";
  return "input";
}

function initialValues(
  parameters: Record<string, ParameterConfig>,
): Record<string, number | string> {
  return Object.fromEntries(
    Object.entries(parameters).map(([key, config]) => [key, config.default]),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const PREFIX = "sct-ParameterController";

export function ParameterControllerComponent({
  channel = "params/control",
  parameters,
  debounceMs = 300,
}: ParameterControllerProps) {
  const publish = usePublish();
  const [values, setValues] = useState<Record<string, number | string>>(() =>
    parameters && Object.keys(parameters).length > 0 ? initialValues(parameters) : {},
  );

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (parameters && Object.keys(parameters).length > 0) {
      setValues(initialValues(parameters));
    } else {
      setValues({});
    }
  }, [parameters]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const publishValues = useCallback(
    (nextValues: Record<string, number | string>) => {
      publish(channel, nextValues);
    },
    [channel, publish],
  );

  const handleChange = useCallback(
    (key: string, value: number | string, debounce = false) => {
      const nextValues = { ...values, [key]: value };
      setValues(nextValues);

      if (debounce) {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          publishValues(nextValues);
        }, debounceMs);
      } else {
        publishValues(nextValues);
      }
    },
    [values, debounceMs, publishValues],
  );

  if (!parameters || Object.keys(parameters).length === 0) {
    return <div className={`${PREFIX}-empty`}>No parameters configured</div>;
  }

  return (
    // Form with no submit button — publishes on each field change.
    // validationMode="onChange" ensures Field errors update live.
    <Form
      className={`${PREFIX}-container`}
      validationMode="onChange"
      onFormSubmit={() => {
        // No-op: submission is driven by individual field onChange handlers.
        // The Form wrapper is here for semantic correctness and Field context.
      }}
    >
      {Object.entries(parameters).map(([key, config]) => {
        const widget = resolveWidget(config);
        const value = values[key] ?? config.default;

        return (
          <Field.Root key={key} name={key} className={`${PREFIX}-row`}>
            <Field.Label className={`${PREFIX}-label`} htmlFor={`param-${key}`}>
              {config.title}
            </Field.Label>

            <div className={`${PREFIX}-control`}>
              {widget === "slider" && (
                <div className={`${PREFIX}-slider-wrapper`}>
                  <Slider
                    key={`${key}-${config.default}`}
                    id={`param-${key}`}
                    aria-label={config.title}
                    min={config.minimum ?? 0}
                    max={config.maximum ?? 100}
                    step={config.multipleOf ?? 1}
                    defaultValue={config.default as number}
                    onValueChange={(newValue) => {
                      handleChange(key, newValue as number, true);
                    }}
                  />
                  <span className={`${PREFIX}-value`}>
                    {(value as number).toLocaleString()}
                  </span>
                </div>
              )}

              {widget === "input" && (
                // Field.Root ancestor satisfies useFieldRootContext
                // used internally by base-ui Input.
                <Field.Control
                  id={`param-${key}`}
                  aria-label={config.title}
                  className={`${PREFIX}-input`}
                  type="number"
                  min={config.minimum}
                  max={config.maximum}
                  step={config.multipleOf}
                  value={String(value)}
                  onChange={(e) =>
                    handleChange(key, (e.target as HTMLInputElement).valueAsNumber)
                  }
                />
              )}

              {widget === "select" && (
                <Select
                  value={value as string}
                  onValueChange={(v: string | null) =>
                    v !== null && handleChange(key, v)
                  }
                >
                  <SelectTrigger
                    id={`param-${key}`}
                    aria-label={config.title}
                    className={`${PREFIX}-select-trigger`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {config.enum?.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </Field.Root>
        );
      })}
    </Form>
  );
}
