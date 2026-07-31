import tkinter as tk


class CalculatorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("電卓")
        self.root.resizable(False, False)

        self.expression = ""

        self.display_var = tk.StringVar(value="0")
        display = tk.Entry(
            root,
            textvariable=self.display_var,
            font=("Arial", 24),
            justify="right",
            bd=8,
            relief="flat",
            state="readonly",
            readonlybackground="white",
        )
        display.grid(row=0, column=0, columnspan=4, sticky="nsew", padx=5, pady=5)

        buttons = [
            ("C", 1, 0), ("(", 1, 1), (")", 1, 2), ("/", 1, 3),
            ("7", 2, 0), ("8", 2, 1), ("9", 2, 2), ("*", 2, 3),
            ("4", 3, 0), ("5", 3, 1), ("6", 3, 2), ("-", 3, 3),
            ("1", 4, 0), ("2", 4, 1), ("3", 4, 2), ("+", 4, 3),
            ("0", 5, 0), (".", 5, 1), ("=", 5, 2, 2),
        ]

        for spec in buttons:
            text, row, col = spec[0], spec[1], spec[2]
            colspan = spec[3] if len(spec) > 3 else 1
            btn = tk.Button(
                root,
                text=text,
                font=("Arial", 16),
                command=lambda t=text: self.on_button_click(t),
            )
            btn.grid(row=row, column=col, columnspan=colspan, sticky="nsew", padx=2, pady=2)

        for i in range(6):
            root.grid_rowconfigure(i, weight=1)
        for i in range(4):
            root.grid_columnconfigure(i, weight=1)

    def on_button_click(self, char):
        if char == "C":
            self.expression = ""
        elif char == "=":
            try:
                result = eval(self.expression, {"__builtins__": {}}, {})
                self.expression = str(result)
            except Exception:
                self.expression = ""
                self.display_var.set("Error")
                return
        else:
            self.expression += char

        self.display_var.set(self.expression if self.expression else "0")


def main():
    root = tk.Tk()
    CalculatorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
