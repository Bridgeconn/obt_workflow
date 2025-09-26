import React, { useState, useEffect } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronDown } from "lucide-react";
import languages from "../data/source_languages.json";


interface LanguageSelectProps {
  onLanguageChange: (selectedId: string) => void;
  selectedLanguageId?: string;
  disabled?: boolean;
}

const LanguageSelect: React.FC<LanguageSelectProps> = ({
  onLanguageChange,
  selectedLanguageId = "",
  disabled = false
}) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(selectedLanguageId);
  const [searchQuery, setSearchQuery] = useState("");

  // Get unique source languages
  const sourceLanguages = [...new Set(languages.map(lang => lang.script_language))];

  // Create groups
  const groupedLanguages = sourceLanguages.map(source => ({
    sourceLanguage: source,
    languages: languages.filter(lang => lang.script_language === source)
  }));

  const selectedLanguage = value
    ? languages.find((lang) => lang.id === parseInt(value))?.language_name
    : "Select Language";

  useEffect(() => {
    if (selectedLanguageId && selectedLanguageId !== value) {
      setValue(selectedLanguageId);
    }
  }, [selectedLanguageId]);

  const getFilteredGroups = (query: string) => {
    if (!query) return groupedLanguages;
    
    return groupedLanguages
      .map(group => ({
        sourceLanguage: group.sourceLanguage,
        languages: group.languages.filter(lang =>
          lang.language_name.toLowerCase().includes(query.toLowerCase())
        )
      }))
      .filter(group => group.languages.length > 0);
  };

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-4 w-auto md:w-auto">
      <label className="text-lg font-semibold text-gray-700 whitespace-nowrap">
        Audio Language
      </label>
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled} className="disabled:cursor-not-allowed">
          <button
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full md:w-[250px] flex items-center justify-between min-h-[40px] text-gray-800 font-medium border rounded-lg px-3 py-2 hover:border-gray-400 focus:ring-2 focus:ring-purple-500"
          >
            {selectedLanguage}
            <ChevronDown className="ml-2 h-5 w-5 text-gray-500" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0" align="start">
          <Command loop>
            <CommandInput
              placeholder="Search language..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>No language found.</CommandEmpty>
              {getFilteredGroups(searchQuery).map((group, index) => (
                <React.Fragment key={group.sourceLanguage}>
                  {index > 0 && <CommandSeparator />}
                  <CommandGroup heading={group.sourceLanguage}>
                    {group.languages.map((language) => (
                      <CommandItem
                        key={language.id}
                        value={language.language_name}
                        onSelect={() => {
                          setValue(String(language.id));
                          setSearchQuery("");
                          setOpen(false);
                          onLanguageChange(String(language.id));
                        }}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${
                            value === String(language.id)
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                        />
                        {language.language_name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </React.Fragment>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default LanguageSelect;